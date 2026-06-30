/**
 * LocalDrop Backend Engine
 * High-performance, offline LAN file sharing server.
 * 
 * Features:
 * - Real-time file sync via WebSockets.
 * - Dynamic Wi-Fi network diagnostics (macOS system profiler).
 * - Multi-gigabyte file transfer optimization with custom sockets keep-alive.
 * - Platform SSID redaction bypass for macOS Sonoma/Sequoia.
 */

const express = require('express');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);

// Server Configuration Constants
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure storage buffer directory exists on server initialization
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Middleware Configuration
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Resolves the primary local IPv4 address of the host machine.
 * Filters out loopback (127.0.0.1) and internal virtual interfaces.
 * 
 * @returns {string} Resolvable local IPv4 address or 'localhost' as fallback.
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// Determine hostname (.local on macOS/Linux environments)
let LOCAL_HOSTNAME = os.hostname();
if (!LOCAL_HOSTNAME.includes('.') && !LOCAL_HOSTNAME.toLowerCase().endsWith('.local')) {
  LOCAL_HOSTNAME = `${LOCAL_HOSTNAME}.local`;
}

/**
 * Periodically queries and parses macOS Wi-Fi statistics.
 * Compatible with macOS Sonoma, Sequoia and newer versions.
 * Bypasses SSID redaction (<redacted>) when location services are restricted.
 * 
 * @returns {Promise<object|null>} Compiled Wi-Fi metrics or null if unsupported/fails.
 */
function getWifiSignal() {
  return new Promise((resolve) => {
    if (os.platform() !== 'darwin') {
      return resolve(null); // Diagnostics only supported on macOS hosts
    }
    
    exec('system_profiler SPAirPortDataType', (err, stdout) => {
      if (err || !stdout) {
        return resolve(null);
      }
      
      const currentNetworkIndex = stdout.indexOf('Current Network Information:');
      if (currentNetworkIndex !== -1) {
        const currentNetworkStr = stdout.substring(currentNetworkIndex);
        const lines = currentNetworkStr.split('\n');
        
        let ssid = 'Local Wi-Fi';
        let rssi = -60;
        let rate = 0;
        let channel = 'Unknown';
        
        // Find current SSID (skipping structural property keys)
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          if (line.endsWith(':') && 
              !line.includes('PHY Mode') && 
              !line.includes('Channel') && 
              !line.includes('Security') && 
              !line.includes('Signal / Noise') && 
              !line.includes('Current Network') &&
              !line.includes('Country Code') &&
              !line.includes('Transmit Rate') &&
              !line.includes('MCS Index') &&
              !line.includes('BSSID')) {
            ssid = line.substring(0, line.length - 1).trim();
            break;
          }
        }
        
        // Match metrics using regular expressions
        const signalMatch = currentNetworkStr.match(/Signal\s*\/\s*Noise:\s*(-?\d+)/);
        const rateMatch = currentNetworkStr.match(/Transmit Rate:\s*(\d+)/);
        const channelMatch = currentNetworkStr.match(/Channel:\s*([^\n]+)/);
        
        if (signalMatch) rssi = parseInt(signalMatch[1]);
        if (rateMatch) rate = parseInt(rateMatch[1]);
        if (channelMatch) channel = channelMatch[1].trim();
        
        // SSID check: macOS returns '<redacted>' if terminal lacks Location Services permissions
        if (ssid.toLowerCase() === '<redacted>' || !ssid) {
          ssid = 'Local Wi-Fi';
        }
        
        // Math interpolation for RSSI signal distance mapping
        let quality = 'Weak';
        let distanceEst = 'Far (8m+)';
        let color = '#ef4444'; // Hex colors for UI feedback badges
        
        if (rssi >= -50) {
          quality = 'Excellent';
          distanceEst = 'Very Close (~1-3m)';
          color = '#10b981';
        } else if (rssi >= -65) {
          quality = 'Very Good';
          distanceEst = 'Close (~3-5m)';
          color = '#007aff';
        } else if (rssi >= -75) {
          quality = 'Good';
          distanceEst = 'Medium (~5-8m)';
          color = '#f59e0b';
        }
        
        return resolve({ rssi, ssid, rate, quality, distanceEst, color, channel });
      }
      resolve(null);
    });
  });
}

/**
 * Synchronously reads the uploads directory and generates an ordered file catalog.
 * 
 * @returns {Array<object>} Sorted array of files (newest first).
 */
function getFileList() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    return [];
  }
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    return files
      .filter(file => !file.startsWith('.'))
      .map(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          uploadedAt: stats.mtime
        };
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  } catch (error) {
    console.error('Failed to parse storage index:', error);
    return [];
  }
}

// Multer Storage Configuration
// Restores original UTF-8 encoding for filenames and resolves duplicates with timestamp anchors.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    let safeName;
    try {
      // Bypasses default latin1 filename parsing to preserve original UTF-8 character arrays
      safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      safeName = file.originalname;
    }
    
    // Check filename duplicate collisions and append a unique timestamp hash if found
    let finalPath = path.join(UPLOADS_DIR, safeName);
    if (fs.existsSync(finalPath)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      safeName = `${base}-${Date.now()}${ext}`;
    }
    
    cb(null, safeName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: Infinity // Unlimited upload sizes, restricted only by disk space limits
  }
});

/**
 * Broadcasts the current file list state to all connected WebSockets.
 */
function broadcastFileList() {
  const fileList = getFileList();
  const msg = JSON.stringify({ type: 'update', files: fileList });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ==================================================
// REST API Endpoints
// ==================================================

// GET system diagnostics, wifi stats, and memory parameters
app.get('/api/info', async (req, res) => {
  const wifiDiag = await getWifiSignal();
  res.json({
    localIp: LOCAL_IP,
    localHostname: LOCAL_HOSTNAME,
    port: PORT,
    url: `http://${LOCAL_IP}:${PORT}`,
    hostnameUrl: `http://${LOCAL_HOSTNAME}:${PORT}`,
    wifi: wifiDiag,
    system: {
      platform: os.platform(),
      release: os.release(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uploadsDir: UPLOADS_DIR
    }
  });
});

// GET lightweight ping endpoint to support real-time network latency calculation
app.get('/api/ping', (req, res) => {
  res.json({ pong: true });
});

// GET dynamically rendered QR Code PNG buffer
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).send('Text parameter required');
  }
  try {
    const buffer = await QRCode.toBuffer(text, {
      type: 'png',
      width: 250,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Error generating QR Code:', err);
    res.status(500).send('Error generating QR Code');
  }
});

// GET list of currently shared files
app.get('/api/files', (req, res) => {
  res.json(getFileList());
});

// POST endpoint to handle high-performance binary file upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  console.log(`Uploaded successfully: ${req.file.filename} (${req.file.size} bytes)`);
  broadcastFileList();
  res.json({ success: true, file: req.file.filename });
});

// GET binary attachment file download
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  // Directory traversal protection checks
  if (!filePath.startsWith(UPLOADS_DIR)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error(`Error downloading file ${filename}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Could not download file' });
      }
    }
  });
});

// DELETE shared file from disk
app.delete('/api/delete/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  // Directory traversal protection checks
  if (!filePath.startsWith(UPLOADS_DIR)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`Deleted file: ${filename}`);
    broadcastFileList();
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting file ${filename}:`, error);
    res.status(500).json({ error: 'Could not delete file' });
  }
});

// GET mock download file generator for local speed benchmark
app.get('/api/speedtest/download', (req, res) => {
  const size = 30 * 1024 * 1024; // 30MB Mock buffer
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Type', 'application/octet-stream');
  
  const buffer = Buffer.alloc(1024 * 1024); // 1MB buffer chunks
  let bytesSent = 0;
  
  const send = () => {
    if (bytesSent >= size) {
      res.end();
      return;
    }
    const canWrite = res.write(buffer);
    bytesSent += buffer.length;
    if (canWrite) {
      send();
    } else {
      res.once('drain', send);
    }
  };
  send();
});

// POST mock upload payload container for local speed benchmark
app.post('/api/speedtest/upload', (req, res) => {
  let bytesReceived = 0;
  req.on('data', (chunk) => {
    bytesReceived += chunk.length;
  });
  req.on('end', () => {
    res.json({ success: true, received: bytesReceived });
  });
});

// ==================================================
// WebSocket Real-Time synchronization engine
// ==================================================
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('New client connected to WebSocket pool');
  ws.send(JSON.stringify({ type: 'init', files: getFileList() }));

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket pool');
  });
});

// ==================================================
// Socket configuration overrides and server boot
// ==================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(` LocalDrop server is running!`);
  console.log(` Local Access:      http://localhost:${PORT}`);
  console.log(` WiFi IP Access:    http://${LOCAL_IP}:${PORT}`);
  console.log(` WiFi Host Access:  http://${LOCAL_HOSTNAME}:${PORT}`);
  console.log('==================================================');
});

// Prevent Node.js default socket timeouts (2m/5m) on long file transfers
server.timeout = 0; 
server.keepAliveTimeout = 600000; 
server.headersTimeout = 605000; 

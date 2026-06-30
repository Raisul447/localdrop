/**
 * LocalDrop Frontend Application Engine
 * Handles real-time DOM management, file uploads, WebSocket syncing,
 * and local network diagnostics/speed benchmarks.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Navigation Tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // DOM Elements - Network Header & QR Code Modal
  const serverUrl = document.getElementById('serverUrl');
  const openQrBtn = document.getElementById('openQrBtn');
  const closeQrBtn = document.getElementById('closeQrBtn');
  const qrModal = document.getElementById('qrModal');
  const modalUrlText = document.getElementById('modalUrlText');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyHostnameBtn = document.getElementById('copyHostnameBtn');

  // DOM Elements - Wi-Fi Diagnostics Status Bar
  const wifiStatusBar = document.getElementById('wifiStatusBar');
  const statusSsid = document.getElementById('statusSsid');
  const statusQuality = document.getElementById('statusQuality');
  const statusDistance = document.getElementById('statusDistance');
  const statusRate = document.getElementById('statusRate');

  // DOM Elements - Upload & Files Pool (Tab 1)
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const activeUploadsContainer = document.getElementById('activeUploadsContainer');
  const activeUploadsList = document.getElementById('activeUploadsList');
  const emptyFilesState = document.getElementById('emptyFilesState');
  const filePoolList = document.getElementById('filePoolList');
  const fileCountBadge = document.getElementById('fileCountBadge');

  // DOM Elements - Speed Test Speedometer (Tab 2)
  const startSpeedTestBtn = document.getElementById('startSpeedTestBtn');
  const speedTestStatus = document.getElementById('speedTestStatus');
  const speedTestStatusText = document.getElementById('speedTestStatusText');
  const speedTestResults = document.getElementById('speedTestResults');
  const speedLatency = document.getElementById('speedLatency');
  const speedDownload = document.getElementById('speedDownload');
  const speedUpload = document.getElementById('speedUpload');
  const gaugeValue = document.getElementById('gaugeValue');
  const gaugeFill = document.getElementById('gaugeFill');
  const gaugePhase = document.getElementById('gaugePhase');
  const speedNeedle = document.getElementById('speedNeedle');

  // DOM Elements - Host System Specs (Tab 3)
  const darkModeToggle = document.getElementById('darkModeToggle');
  const autoDiagnosticsToggle = document.getElementById('autoDiagnosticsToggle');
  const storagePathText = document.getElementById('storagePathText');
  const specHostname = document.getElementById('specHostname');
  const specOs = document.getElementById('specOs');
  const specPlatform = document.getElementById('specPlatform');
  const specRam = document.getElementById('specRam');

  // State Management Variables
  let localServerUrl = window.location.origin;
  const activeUploads = {}; // Tracks active XHR connections for cancel operations
  let diagIntervalId = null;

  // ==================================================
  // SPA Tab Navigation Routing Logic
  // ==================================================
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Toggle active states on tab controls
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active-tab'));
      
      tab.classList.add('active');
      const targetId = `tabContent${tab.getAttribute('data-tab').charAt(0).toUpperCase() + tab.getAttribute('data-tab').slice(1)}`;
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('active-tab');
      }
    });
  });

  // ==================================================
  // Dark/Light Theme Configuration
  // ==================================================
  // Restores user preference from localStorage caching
  if (localStorage.getItem('dark-theme') === 'true') {
    document.body.classList.add('dark-theme');
    if (darkModeToggle) darkModeToggle.checked = true;
  }

  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
      if (darkModeToggle.checked) {
        document.body.classList.add('dark-theme');
        localStorage.setItem('dark-theme', 'true');
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('dark-theme', 'false');
      }
    });
  }

  // ==================================================
  // System Diagnostics & Network Parameters Sync
  // ==================================================

  /**
   * Fetches latest network diagnostics and hardware specifications from the server.
   * Maps SSID details, signal estimates, and platform info to the DOM.
   */
  function fetchInfoAndDiagnostics() {
    fetch('/api/info')
      .then(res => res.json())
      .then(data => {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        localServerUrl = isLocalhost ? data.url : window.location.origin;
        
        serverUrl.textContent = localServerUrl;
        modalUrlText.textContent = localServerUrl;
        generateQrCode(localServerUrl);
        
        // Populate alternative hostname .local address for iOS/macOS domains
        const alternativeUrlContainer = document.getElementById('alternativeUrlContainer');
        const modalHostnameText = document.getElementById('modalHostnameText');
        if (alternativeUrlContainer && modalHostnameText) {
          modalHostnameText.textContent = data.hostnameUrl;
          alternativeUrlContainer.style.display = 'block';
        }

        // Render Horizontal Wi-Fi status bar parameters
        if (data.wifi) {
          statusSsid.textContent = data.wifi.ssid;
          statusQuality.innerHTML = `<span style="color: ${data.wifi.color}; font-weight: 700;">${data.wifi.quality} (${data.wifi.rssi} dBm)</span>`;
          statusDistance.innerHTML = `<span style="font-weight: 600;">${data.wifi.distanceEst}</span>`;
          statusRate.textContent = `${data.wifi.rate} Mbps`;
          wifiStatusBar.style.display = 'flex';
        } else {
          wifiStatusBar.style.display = 'none';
        }

        // Populate System Specifications inside Settings Tab
        if (storagePathText) storagePathText.textContent = data.system.uploadsDir;
        if (specHostname) specHostname.textContent = data.localHostname;
        if (specOs) specOs.textContent = `${data.system.platform} (${data.system.release})`;
        if (specPlatform) specPlatform.textContent = data.system.platform === 'darwin' ? 'macOS (Apple Silicon/Intel)' : data.system.platform;
        if (specRam) {
          const totalGB = Math.round(data.system.totalMem / (1024 * 1024 * 1024));
          const freeGB = (data.system.freeMem / (1024 * 1024 * 1024)).toFixed(1);
          specRam.textContent = `${totalGB} GB Total (${freeGB} GB Free)`;
        }
      })
      .catch(err => {
        console.error('Error fetching server info:', err);
        const fallbackUrl = window.location.origin;
        serverUrl.textContent = fallbackUrl;
        modalUrlText.textContent = fallbackUrl;
        generateQrCode(fallbackUrl);
      });
  }

  fetchInfoAndDiagnostics();

  /**
   * Sets up periodic background diagnostics querying.
   */
  function startDiagInterval() {
    diagIntervalId = setInterval(fetchInfoAndDiagnostics, 10000);
  }
  
  startDiagInterval();

  // Toggle dynamic hardware profile querying from settings controls
  if (autoDiagnosticsToggle) {
    autoDiagnosticsToggle.addEventListener('change', () => {
      if (autoDiagnosticsToggle.checked) {
        startDiagInterval();
      } else {
        if (diagIntervalId) {
          clearInterval(diagIntervalId);
          diagIntervalId = null;
        }
      }
    });
  }

  // ==================================================
  // WebSocket Server Connection for Live File Pool Sync
  // ==================================================
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  let ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'init' || data.type === 'update') {
        renderFileList(data.files);
      }
    } catch (e) {
      console.error('Error parsing WebSocket sync payload:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected. Attempting auto reconnection...');
    setTimeout(() => {
      ws = new WebSocket(wsUrl);
    }, 3000);
  };

  // ==================================================
  // Drag & Drop File Upload Actions
  // ==================================================
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesUpload(files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFilesUpload(files);
    }
  });

  // ==================================================
  // Modal Interactions
  // ==================================================
  openQrBtn.addEventListener('click', () => {
    qrModal.classList.add('active');
  });

  closeQrBtn.addEventListener('click', () => {
    qrModal.classList.remove('active');
  });

  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
      qrModal.classList.remove('active');
    }
  });

  // ==================================================
  // Clipboard Copy Action Listeners
  // ==================================================
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(modalUrlText.textContent)
      .then(() => {
        const origColor = copyUrlBtn.style.color;
        copyUrlBtn.style.color = '#10b981'; // Green visual indicator
        setTimeout(() => copyUrlBtn.style.color = origColor, 1500);
      })
      .catch(err => console.error('Failed to copy text:', err));
  });

  if (copyHostnameBtn) {
    copyHostnameBtn.addEventListener('click', () => {
      const modalHostnameText = document.getElementById('modalHostnameText');
      navigator.clipboard.writeText(modalHostnameText.textContent)
        .then(() => {
          const origColor = copyHostnameBtn.style.color;
          copyHostnameBtn.style.color = '#10b981';
          setTimeout(() => copyHostnameBtn.style.color = origColor, 1500);
        })
        .catch(err => console.error('Failed to copy hostname:', err));
    });
  }

  /**
   * Generates QR Code using system API.
   * 
   * @param {string} url Connection link to encode.
   */
  function generateQrCode(url) {
    const qrImage = document.getElementById('qrImage');
    if (qrImage) {
      qrImage.src = `/api/qr?text=${encodeURIComponent(url)}`;
    }
  }

  /**
   * Iterates and schedules upload actions for multiple dropped files.
   * 
   * @param {FileList} files Selection of local files.
   */
  function handleFilesUpload(files) {
    activeUploadsContainer.style.display = 'block';
    Array.from(files).forEach(file => {
      uploadFile(file);
    });
  }

  /**
   * Initiates direct multipart file upload utilizing XMLHttpRequest.
   * Includes live transfer rate calculations and abort buttons.
   * 
   * @param {File} file Binary file chunk.
   */
  function uploadFile(file) {
    const fileId = 'up_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const uploadItem = document.createElement('div');
    uploadItem.className = 'upload-progress-item';
    uploadItem.id = fileId;
    
    uploadItem.innerHTML = `
      <div class="progress-header">
        <span class="progress-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="progress-stats" id="stats_${fileId}">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="bar_${fileId}"></div>
      </div>
      <div class="progress-footer">
        <span id="speed_${fileId}">Starting...</span>
        <span id="bytes_${fileId}">0 / ${formatBytes(file.size)}</span>
        <button class="upload-cancel-btn" onclick="cancelUpload('${fileId}')" title="Cancel Upload">Cancel</button>
      </div>
    `;
    activeUploadsList.insertBefore(uploadItem, activeUploadsList.firstChild);

    const xhr = new XMLHttpRequest();
    activeUploads[fileId] = xhr; // Stores reference for dynamic cancellation triggers

    const formData = new FormData();
    formData.append('file', file);

    let startTime = Date.now();

    // XMLHttpRequest progress tracking hooks
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        
        let speedText = '';
        if (elapsed > 0) {
          const speedBytesPerSec = e.loaded / elapsed;
          speedText = formatBytes(speedBytesPerSec) + '/s';
        }

        document.getElementById(`bar_${fileId}`).style.width = percent + '%';
        document.getElementById(`stats_${fileId}`).textContent = percent + '%';
        document.getElementById(`bytes_${fileId}`).textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
        document.getElementById(`speed_${fileId}`).textContent = speedText;
      }
    });

    xhr.addEventListener('load', () => {
      delete activeUploads[fileId];
      if (xhr.status === 200) {
        document.getElementById(`speed_${fileId}`).textContent = 'Completed';
        document.getElementById(`speed_${fileId}`).style.color = '#10b981';
        document.getElementById(`bar_${fileId}`).style.backgroundColor = '#10b981';
        const cancelBtn = uploadItem.querySelector('.upload-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        setTimeout(() => {
          uploadItem.remove();
          checkActiveUploadsEmpty();
        }, 1200);
      } else {
        handleUploadError(fileId, 'Failed');
      }
    });

    xhr.addEventListener('error', () => handleUploadError(fileId, 'Network Error'));
    xhr.addEventListener('abort', () => handleUploadError(fileId, 'Cancelled'));

    xhr.open('POST', '/api/upload', true);
    xhr.send(formData);
  }

  /**
   * Terminate active XMLHttpRequest payload streaming.
   * 
   * @param {string} fileId Upload element mapping index.
   */
  window.cancelUpload = (fileId) => {
    const xhr = activeUploads[fileId];
    if (xhr) {
      xhr.abort();
      delete activeUploads[fileId];
    }
  };

  /**
   * Resets progress indicators to error status when uploads crash or abort.
   * 
   * @param {string} fileId Upload mapping key.
   * @param {string} statusText Visual error text.
   */
  function handleUploadError(fileId, statusText) {
    delete activeUploads[fileId];
    const speedEl = document.getElementById(`speed_${fileId}`);
    const barEl = document.getElementById(`bar_${fileId}`);
    const itemEl = document.getElementById(fileId);
    
    if (speedEl) {
      speedEl.textContent = statusText;
      speedEl.style.color = '#ef4444';
    }
    if (barEl) {
      barEl.style.backgroundColor = '#ef4444';
    }
    
    const cancelBtn = itemEl ? itemEl.querySelector('.upload-cancel-btn') : null;
    if (cancelBtn) cancelBtn.style.display = 'none';

    setTimeout(() => {
      const el = document.getElementById(fileId);
      if (el) el.remove();
      checkActiveUploadsEmpty();
    }, 3000);
  }

  /**
   * Hides the active uploads container wrapper if no tasks are processing.
   */
  function checkActiveUploadsEmpty() {
    if (activeUploadsList.children.length === 0) {
      activeUploadsContainer.style.display = 'none';
    }
  }

  /**
   * Generates catalog templates inside the Shared Pool panel.
   * 
   * @param {Array<object>} files Current server file directory catalog.
   */
  function renderFileList(files) {
    if (!files || files.length === 0) {
      emptyFilesState.style.display = 'flex';
      filePoolList.style.display = 'none';
      fileCountBadge.textContent = '0 files';
      return;
    }

    emptyFilesState.style.display = 'none';
    filePoolList.style.display = 'flex';
    fileCountBadge.textContent = `${files.length} file${files.length > 1 ? 's' : ''}`;

    filePoolList.innerHTML = '';
    files.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      
      const fileExt = file.name.split('.').pop().toLowerCase();
      const dateStr = new Date(file.uploadedAt).toLocaleString();

      fileItem.innerHTML = `
        <div class="file-info-col">
          <div class="file-type-icon">
            ${getFileIconSvg(fileExt)}
          </div>
          <div class="file-meta">
            <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="file-details">
              <span>${formatBytes(file.size)}</span>
              <span>•</span>
              <span>${dateStr}</span>
            </div>
          </div>
        </div>
        <div class="file-actions">
          <a class="action-btn download-btn" href="/api/download/${encodeURIComponent(file.name)}" download title="Download File">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </a>
          <button class="action-btn delete-btn" data-filename="${escapeHtml(file.name)}" title="Delete File">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      `;
      filePoolList.appendChild(fileItem);
    });

    // Delete Event Binding hooks
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filename = btn.getAttribute('data-filename');
        if (confirm(`Are you sure you want to delete "${filename}"?`)) {
          fetch(`/api/delete/${encodeURIComponent(filename)}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
              if (!data.success) alert('Failed to delete file.');
            })
            .catch(err => console.error('Error deleting file:', err));
        }
      });
    });
  }

  // ==================================================
  // Local Speed Test Benchmarking (SVG Speedometer)
  // ==================================================
  startSpeedTestBtn.addEventListener('click', () => {
    runSpeedTest();
  });

  /**
   * Map Mbps values (0-1000) to a linear percentile scale (0.0-1.0).
   * Maps non-linear tick parameters symmetrically inside the speedometer.
   * 
   * @param {number} speedMbps Speed readout.
   * @returns {number} Ratio index.
   */
  function getSpeedPercent(speedMbps) {
    if (speedMbps <= 0) return 0;
    if (speedMbps >= 1000) return 1;
    
    if (speedMbps <= 5) {
      return (speedMbps / 5) * 0.125;
    } else if (speedMbps <= 10) {
      return 0.125 + ((speedMbps - 5) / 5) * 0.125;
    } else if (speedMbps <= 50) {
      return 0.25 + ((speedMbps - 10) / 40) * 0.125;
    } else if (speedMbps <= 100) {
      return 0.375 + ((speedMbps - 50) / 50) * 0.125;
    } else if (speedMbps <= 250) {
      return 0.5 + ((speedMbps - 100) / 150) * 0.125;
    } else if (speedMbps <= 500) {
      return 0.625 + ((speedMbps - 250) / 250) * 0.125;
    } else if (speedMbps <= 750) {
      return 0.75 + ((speedMbps - 500) / 250) * 0.125;
    } else {
      return 0.875 + ((speedMbps - 750) / 250) * 0.125;
    }
  }

  /**
   * Adjusts the circular indicator fill offset and needle angle dynamically.
   * 
   * @param {number} speedMbps Speed reading.
   * @param {string} phase Testing status (Ready, Finished, Download).
   */
  function updateGauge(speedMbps, phase) {
    if (gaugeValue) gaugeValue.textContent = speedMbps.toFixed(2);
    if (gaugePhase) gaugePhase.textContent = phase;
    
    const percent = getSpeedPercent(speedMbps);
    
    // Adjust stroke dashoffset parameter inside SVG path (260 deg arc)
    if (gaugeFill) {
      const offset = maxOffset - (percent * maxOffset);
      gaugeFill.style.strokeDashoffset = offset;
    }
    
    // Rotate the pointing indicator needle (ranges from -130 to 130 deg)
    if (speedNeedle) {
      const angle = -130 + (percent * 260);
      speedNeedle.setAttribute('transform', `rotate(${angle} 50 50)`);
    }
  }

  /**
   * Orchestrates the 3-step benchmark: Ping (latency), Download, and Upload.
   */
  async function runSpeedTest() {
    startSpeedTestBtn.disabled = true;
    speedTestStatus.style.display = 'inline-flex';
    
    speedLatency.textContent = 'Testing...';
    speedDownload.textContent = 'Testing...';
    speedUpload.textContent = 'Testing...';
    updateGauge(0, 'PING');

    try {
      // 1. Latency Calculation (Ping) - targets the lightweight ping API
      speedTestStatusText.textContent = 'Testing latency (Ping)...';
      const latencies = [];
      for (let i = 0; i < 4; i++) {
        const start = performance.now();
        await fetch(`/api/ping?nocache=${Date.now()}`);
        const diff = performance.now() - start;
        latencies.push(diff);
      }
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      speedLatency.textContent = `${avgLatency.toFixed(1)} ms`;

      // 2. Download Speed Test
      speedTestStatusText.textContent = 'Testing download speed...';
      updateGauge(0, 'DOWNLOAD');
      const downloadStart = Date.now();
      const dlXhr = new XMLHttpRequest();
      
      let finalDownloadSpeed = 0;
      const downloadPromise = new Promise((resolve, reject) => {
        dlXhr.open('GET', `/api/speedtest/download?nocache=${Date.now()}`, true);
        dlXhr.onprogress = (e) => {
          if (e.lengthComputable) {
            const elapsed = (Date.now() - downloadStart) / 1000;
            if (elapsed > 0) {
              const currentSpeedMB = (e.loaded / (1024 * 1024)) / elapsed; // MB/s
              const currentSpeedMbps = currentSpeedMB * 8;
              speedDownload.textContent = `${currentSpeedMbps.toFixed(2)} Mbps`;
              updateGauge(currentSpeedMbps, 'DOWNLOAD');
            }
          }
        };
        dlXhr.onload = () => {
          const duration = (Date.now() - downloadStart) / 1000;
          const sizeMB = dlXhr.response.byteLength / (1024 * 1024);
          finalDownloadSpeed = sizeMB / duration;
          const finalSpeedMbps = finalDownloadSpeed * 8;
          speedDownload.textContent = `${finalSpeedMbps.toFixed(2)} Mbps`;
          updateGauge(finalSpeedMbps, 'DOWNLOAD');
          resolve();
        };
        dlXhr.onerror = () => reject(new Error('Download failed'));
        dlXhr.responseType = 'arraybuffer';
        dlXhr.send();
      });

      await downloadPromise;
      await new Promise(r => setTimeout(r, 800)); // Sleep brief window before upload starts

      // 3. Upload Speed Test
      speedTestStatusText.textContent = 'Testing upload speed...';
      updateGauge(0, 'UPLOAD');
      // Construct 15MB upload stream buffer
      const uploadSize = 15 * 1024 * 1024; 
      const mockData = new Uint8Array(uploadSize);
      
      const uploadStart = Date.now();
      const ulXhr = new XMLHttpRequest();

      let finalUploadSpeed = 0;
      const uploadPromise = new Promise((resolve, reject) => {
        ulXhr.open('POST', '/api/speedtest/upload', true);
        ulXhr.setRequestHeader('Content-Type', 'application/octet-stream');
        ulXhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const elapsed = (Date.now() - uploadStart) / 1000;
            if (elapsed > 0) {
              const currentSpeedMB = (e.loaded / (1024 * 1024)) / elapsed;
              const currentSpeedMbps = currentSpeedMB * 8;
              speedUpload.textContent = `${currentSpeedMbps.toFixed(2)} Mbps`;
              updateGauge(currentSpeedMbps, 'UPLOAD');
            }
          }
        };
        ulXhr.onload = () => {
          const duration = (Date.now() - uploadStart) / 1000;
          const sizeMB = uploadSize / (1024 * 1024);
          finalUploadSpeed = sizeMB / duration;
          const finalSpeedMbps = finalUploadSpeed * 8;
          speedUpload.textContent = `${finalSpeedMbps.toFixed(2)} Mbps`;
          updateGauge(finalSpeedMbps, 'UPLOAD');
          resolve();
        };
        ulXhr.onerror = () => reject(new Error('Upload failed'));
        ulXhr.send(mockData);
      });

      await uploadPromise;
      speedTestStatusText.textContent = 'Speed test completed!';
      const finalUploadSpeedMbps = finalUploadSpeed * 8;
      updateGauge(finalUploadSpeedMbps, 'FINISHED');

    } catch (err) {
      console.error(err);
      speedTestStatusText.textContent = 'Speed test failed.';
      updateGauge(0, 'ERROR');
    } finally {
      startSpeedTestBtn.disabled = false;
      setTimeout(() => {
        speedTestStatus.style.display = 'none';
      }, 3000);
    }
  }

  // ==================================================
  // Formatting & Utility Helpers
  // ==================================================

  /**
   * Converts byte numbers into human-readable unit strings.
   * 
   * @param {number} bytes Input bytes.
   * @param {number} decimals Precisions.
   * @returns {string} String with units mapping.
   */
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Sanitizes input tags to prevent XSS vulnerability vectors.
   * 
   * @param {string} string Unsanitized character array.
   * @returns {string} Clean HTML string.
   */
  function escapeHtml(string) {
    return String(string).replace(/[&<>"']/g, function (s) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[s];
    });
  }

  /**
   * Resolves SVG icon paths based on file extension categories.
   * 
   * @param {string} ext Extension key.
   * @returns {string} String containing inline SVG template.
   */
  function getFileIconSvg(ext) {
    const images = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'];
    const videos = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv'];
    const audios = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
    const archives = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2'];
    const docs = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv'];

    if (images.includes(ext)) {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      `;
    } else if (videos.includes(ext)) {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
      `;
    } else if (audios.includes(ext)) {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      `;
    } else if (archives.includes(ext)) {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
        </svg>
      `;
    } else if (docs.includes(ext)) {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      `;
    } else {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon-svg">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
          <polyline points="13 2 13 9 20 9"></polyline>
        </svg>
      `;
    }
  }
});

// 1. Digital Clock & Global States
let zoneState = {}; // Tracks if a zone is tripped (true) or normal (false)

setInterval(() => {
  document.getElementById('live-clock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// 2. Tab Navigation (Switching Modules)
window.switchView = function(viewId, menuItem) {
  // Update sidebar highlighting
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
  menuItem.classList.add('active');

  // Hide all views, show selected
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');

  // Load telemetry logs if viewing that tab
  if(viewId === 'telemetry') loadLogs();
}

// 3. Fetch BYPL Topology & Build Dynamic SLD
async function loadTopology() {
  try {
    const res = await fetch('/api/topology');
    const zones = await res.json();
    buildSLD(zones);
  } catch (err) {
    console.error("Database connection failed", err);
  }
}

function buildSLD(zones) {
  const nodesContainer = document.getElementById('dynamic-nodes');
  const wiresContainer = document.getElementById('dynamic-wires');
  const buttonsContainer = document.getElementById('override-buttons');
  
  nodesContainer.innerHTML = ''; wiresContainer.innerHTML = ''; buttonsContainer.innerHTML = '';
  const spacing = 96 / zones.length;

  zones.forEach((zone, index) => {
    zoneState[zone.id] = false; // Initialize all as normal
    const xPos = (spacing * index) + 3.5;
    
    wiresContainer.innerHTML += `
      <line x1="${xPos}%" y1="52%" x2="${xPos}%" y2="72%" class="power-line" />
      <line x1="${xPos}%" y1="52%" x2="${xPos}%" y2="72%" class="current-flow" id="flow-${zone.id}" />
    `;

    nodesContainer.innerHTML += `
      <div class="feeder-group" style="top: 58%; left: ${xPos}%; transform: translateX(-50%);">
        <div class="breaker" id="brk-${zone.id}" onclick="toggleFault('${zone.id}', '${zone.name}')" title="Toggle Breaker">CB</div>
      </div>
      <div class="component load" style="top: 72%; left: ${xPos}%; transform: translateX(-50%); width: 130px;">
        <h4>${zone.name}</h4><p>${zone.location}</p>
        <span style="font-size:9px; color:#0d9488; font-weight:bold;">${zone.circle} Circle</span>
      </div>
    `;

    buttonsContainer.innerHTML += `
      <button class="btn btn-danger" id="btn-${zone.id}" data-name="${zone.name}" onclick="toggleFault('${zone.id}', '${zone.name}')">TRIP ${zone.id} · ${zone.name}</button>
    `;
  });
}

// 4. Fault Toggling Logic (Individual Tripping & Restoring)
window.toggleFault = async function(zoneId, zoneName) {
  if (zoneState[zoneId]) {
    await fetch(`/clear-zone?zone=${zoneId}`); // If tripped, restore it
  } else {
    await fetch(`/trigger-fault?zone=${zoneId}`); // If normal, trip it
  }
};

window.clearAllFaults = async function() {
  await fetch('/clear-fault');
};

// 5. Fetch SNMP & Telemetry Logs
async function loadNetwork() {
  const table = document.getElementById('network-table');
  try {
    const res = await fetch('/api/network');
    const data = await res.json();
    table.innerHTML = data.map(n => `<tr><td><strong>${n.rtu}</strong></td><td style="font-family:monospace; color:#94a3b8;">${n.ip}</td><td>${n.lat}</td><td class="${n.status === 'ONLINE' ? 'status-ok' : 'status-warn'}">${n.status}</td></tr>`).join('');
  } catch (err) { table.innerHTML = `<tr><td colspan="4">Network Polling Failed</td></tr>`; }
}

async function loadLogs() {
  const table = document.getElementById('telemetry-table');
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    table.innerHTML = data.map(log => `<tr><td>#${log.id}</td><td style="color:#94a3b8;">${new Date(log.timestamp).toLocaleString()}</td><td class="${log.event === 'FAULT' ? 'status-warn' : 'status-ok'}">${log.event}</td><td>${log.details}</td></tr>`).join('');
  } catch (err) { table.innerHTML = `<tr><td colspan="4">Log Polling Failed</td></tr>`; }
}

// 6. Socket.io Event Handling (Updates UI seamlessly)
const socket = io();
socket.on("nfc-action", (data) => {
  if (data.command === 'FAULT') {
    zoneState[data.zone] = true;
    document.getElementById(`brk-${data.zone}`)?.classList.add('fault');
    document.getElementById(`flow-${data.zone}`)?.classList.add('fault');
    const btn = document.getElementById(`btn-${data.zone}`);
    if(btn) { btn.className = 'btn btn-restore'; btn.innerText = `RESTORE ${data.zone}`; }
    
  } else if (data.command === 'CLEAR_ZONE') {
    zoneState[data.zone] = false;
    document.getElementById(`brk-${data.zone}`)?.classList.remove('fault');
    document.getElementById(`flow-${data.zone}`)?.classList.remove('fault');
    const btn = document.getElementById(`btn-${data.zone}`);
    if(btn) { btn.className = 'btn btn-danger'; btn.innerText = `TRIP ${data.zone} · ${btn.getAttribute('data-name')}`; }
    
  } else if (data.command === 'CLEAR') {
    Object.keys(zoneState).forEach(k => zoneState[k] = false);
    document.querySelectorAll('.breaker').forEach(b => b.classList.remove('fault'));
    document.querySelectorAll('.current-flow').forEach(f => f.classList.remove('fault'));
    document.querySelectorAll('[id^="btn-Z-"]').forEach(btn => {
      btn.className = 'btn btn-danger';
      btn.innerText = `TRIP ${btn.id.replace('btn-', '')} · ${btn.getAttribute('data-name')}`;
    });
  }
});

// Boot Sequence
loadTopology();
loadNetwork();
setInterval(loadNetwork, 5000);
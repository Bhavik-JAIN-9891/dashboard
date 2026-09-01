const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Persistent SQLite Database Initialization
const dbPath = path.resolve(__dirname, 'scada_master.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite SCADA database.');
});

// Database Schema & Authentic 14 BYPL Divisions Injection
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, event TEXT, details TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS bypl_zones (id TEXT PRIMARY KEY, name TEXT, location TEXT, circle TEXT, status TEXT DEFAULT 'NORMAL')`);

  const zones = [
    ['Z-01', 'Chandni Chowk', 'Town Hall Substation', 'Central'],
    ['Z-02', 'Dariya Ganj', 'Kamla Market Substation', 'Central'],
    ['Z-03', 'Pahar Ganj', 'Aram Bagh 11kV Grid', 'Central'],
    ['Z-04', 'Shankar Road', 'Shankar Road 33kV Grid', 'Central'],
    ['Z-05', 'Patel Nagar', 'East Patel Nagar Blk-18', 'Central'],
    ['Z-06', 'Karkardooma', 'CBD-III Grid', 'East'],
    ['Z-07', 'G T Road', 'Shahdara Substation', 'East'],
    ['Z-08', 'Krishna Nagar', 'F-15/2 Substation', 'East'],
    ['Z-09', 'Laxmi Nagar', 'Radhu Palace Grid', 'East'],
    ['Z-10', 'Mayur Vihar I-II', 'Pocket 1 Substation', 'East'],
    ['Z-11', 'Mayur Vihar-III', 'Substation Bldg 7', 'East'],
    ['Z-12', 'Yamuna Vihar', 'C-7 Substation', 'East'],
    ['Z-13', 'Karawal Nagar', '66kV Bhagirathi Grid', 'East'],
    ['Z-14', 'Nand Nagri', 'Tahirpur Grid C-102', 'East']
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO bypl_zones (id, name, location, circle) VALUES (?, ?, ?, ?)`);
  zones.forEach(z => stmt.run(z));
  stmt.finalize();
});

// Serve Frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// API: Fetch All BYPL Grid Zones (includes persisted status)
app.get('/api/topology', (req, res) => {
  db.all(`SELECT * FROM bypl_zones ORDER BY id`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// API: Network Diagnostics (SNMP, IP, and Simulated Latency)
app.get('/api/network', (req, res) => {
  const diagnostics = [
    { rtu: 'RTU-CCK-01 (Chandni Chowk)', ip: '10.14.1.12', lat: Math.floor(Math.random() * 20 + 10) + 'ms', status: 'ONLINE' },
    { rtu: 'RTU-PHG-02 (Pahar Ganj)', ip: '10.14.3.44', lat: Math.floor(Math.random() * 30 + 15) + 'ms', status: 'ONLINE' },
    { rtu: 'RTU-KKD-03 (Karkardooma)', ip: '10.14.6.18', lat: Math.floor(Math.random() * 15 + 10) + 'ms', status: 'ONLINE' },
    { rtu: 'RTU-YMV-04 (Yamuna Vihar)', ip: '10.14.12.8', lat: Math.floor(Math.random() * 25 + 10) + 'ms', status: 'ONLINE' },
    { rtu: 'RTU-KRW-05 (Karawal Nagar)', ip: '10.14.13.2', lat: 'TIMEOUT', status: 'WARN' },
    { rtu: 'RTU-NND-06 (Nand Nagri)', ip: '10.14.14.150', lat: Math.floor(Math.random() * 40 + 20) + 'ms', status: 'ONLINE' }
  ];
  res.json(diagnostics);
});

// API: Hardware / NFC Fault Trigger — persists status so it survives a refresh/restart
app.get('/trigger-fault', (req, res) => {
  const zone = req.query.zone || 'Z-12';
  const ts = new Date().toISOString();
  db.run(`UPDATE bypl_zones SET status = 'FAULT' WHERE id = ?`, [zone], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO audit_logs (timestamp, event, details) VALUES (?, ?, ?)`, [ts, 'FAULT', `BYPL ${zone} Tripped`]);
    io.emit('nfc-action', { command: 'FAULT', zone: zone });
    res.json({ status: 'SUCCESS', message: `${zone} Tripped`, timestamp: ts });
  });
});

// API: Clear Individual Zone Fault — persists status
app.get('/clear-zone', (req, res) => {
  const zone = req.query.zone;
  const ts = new Date().toISOString();
  db.run(`UPDATE bypl_zones SET status = 'NORMAL' WHERE id = ?`, [zone], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO audit_logs (timestamp, event, details) VALUES (?, ?, ?)`, [ts, 'RESTORE', `BYPL ${zone} Restored`]);
    io.emit('nfc-action', { command: 'CLEAR_ZONE', zone: zone });
    res.json({ status: 'SUCCESS', message: `${zone} Restored`, timestamp: ts });
  });
});

// API: Fetch Audit Logs
app.get('/api/logs', (req, res) => {
  db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// API: Global Clear — restores every zone, persists status
app.get('/clear-fault', (req, res) => {
  const ts = new Date().toISOString();
  db.run(`UPDATE bypl_zones SET status = 'NORMAL'`, [], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO audit_logs (timestamp, event, details) VALUES (?, ?, ?)`, [ts, 'CLEAR', 'All BYPL Zones Restored']);
    io.emit('nfc-action', { command: 'CLEAR' });
    res.json({ status: 'SUCCESS', message: 'System Restored', timestamp: ts });
  });
});

server.listen(3000, () => console.log('BYPL SCADA Server active on http://localhost:3000'));

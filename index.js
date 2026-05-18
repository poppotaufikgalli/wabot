const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

const { pool, initDB } = require('./src/db.js');
const { processMsg } = require('./src/IspChat.js');
const { processWithAI } = require('./src/agentic-ai.js');
const { saveHistory } = require('./src/saveHistory.js');

let mode = 'manual';
// In-memory session tracking
const sessions = {};
const TIMEOUT_DURATION = 60000;

// Settings cache
let appSettings = { bot_mode: 'manual' };
async function loadSettings() {
    try {
        const [rows] = await pool.query('SELECT * FROM settings');
        rows.forEach(row => {
            appSettings[row.key] = row.value;
        });
        mode = appSettings.bot_mode;
    } catch (err) {
        console.error('Error loading settings:', err);
    }
}

// Initialize Database
initDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'wabot-secret-key-123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Auth Middleware
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

const isAdmin = (req, res, next) => {
    if (req.session.role === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Forbidden: Admin access required' });
};

// Auth Routes
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.role = user.role;
                return res.json({ success: true, redirect: '/' });
            }
        }
        res.status(401).json({ error: 'Invalid username or password' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// User Management API
app.get('/api/users', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, full_name, role, created_at FROM users');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', isAuthenticated, isAdmin, async (req, res) => {
    const { username, password, full_name, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, full_name, role]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', isAuthenticated, isAdmin, async (req, res) => {
    const { username, password, full_name, role } = req.body;
    try {
        let query = 'UPDATE users SET username = ?, full_name = ?, role = ? WHERE id = ?';
        let params = [username, full_name, role, req.params.id];

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query = 'UPDATE users SET username = ?, password = ?, full_name = ?, role = ? WHERE id = ?';
            params = [username, hashedPassword, full_name, role, req.params.id];
        }

        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected Frontend Routes
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/users', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'users.html'));
});

app.get('/history.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'history.html'));
});

app.get('/settings', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'settings.html'));
});

app.get('/isp-answers', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'isp_answers.html'));
});

app.get('/ai-knowledge', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'ai_knowledge.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Create a new client instance
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '_xxhsj_session'
    })
});

// WebSocket logic
io.on('connection', (socket) => {
    console.log('A user connected');
    console.log('whatsappready', client.info);
    if (client.info !== undefined) {
        io.emit('authenticated');
    }
});

// API Endpoints for History
app.get('/api/history', isAuthenticated, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT user_id as id, pushname as name, MAX(timestamp) as lastActive 
            FROM chat_history 
            GROUP BY user_id
            ORDER BY lastActive DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/history/:id', isAuthenticated, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT role, content, timestamp FROM chat_history WHERE user_id = ? ORDER BY timestamp ASC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoints for Settings
app.get('/api/settings', isAuthenticated, isAdmin, async (req, res) => {
    try {
        await loadSettings();
        res.json(appSettings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', isAuthenticated, isAdmin, async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`value\` = ?',
            [key, value, value]
        );
        await loadSettings();
        res.json({ success: true, settings: appSettings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoints for ISP Answers
app.get('/api/isp-answers', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM isp_answers ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/isp-answers', isAuthenticated, isAdmin, async (req, res) => {
    const { keywords, answer } = req.body;
    try {
        await pool.query('INSERT INTO isp_answers (keywords, answer) VALUES (?, ?)', [keywords, answer]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/isp-answers/:id', isAuthenticated, isAdmin, async (req, res) => {
    const { keywords, answer } = req.body;
    try {
        await pool.query('UPDATE isp_answers SET keywords = ?, answer = ? WHERE id = ?', [keywords, answer, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/isp-answers/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM isp_answers WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoints for AI Knowledge Base
app.get('/api/ai-knowledge', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM ai_knowledge ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-knowledge', isAuthenticated, isAdmin, async (req, res) => {
    const { title, content } = req.body;
    try {
        await pool.query('INSERT INTO ai_knowledge (title, content) VALUES (?, ?)', [title, content]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/ai-knowledge/:id', isAuthenticated, isAdmin, async (req, res) => {
    const { title, content } = req.body;
    try {
        await pool.query('UPDATE ai_knowledge SET title = ?, content = ? WHERE id = ?', [title, content, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai-knowledge/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM ai_knowledge WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoint to send manual message
app.post('/api/chat/send', isAuthenticated, async (req, res) => {
    const { userId, message } = req.body;
    try {
        if (!client.info) return res.status(503).json({ error: 'WhatsApp client not ready' });

        await client.sendMessage(userId, message);
        await saveHistory(userId, 'admin', message, userId.split('@')[0], 'Admin');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoint to toggle session mode
app.post('/api/chat/mode', isAuthenticated, (req, res) => {
    const { userId, mode } = req.body; // mode: 'bot' or 'agen'
    if (!sessions[userId]) {
        sessions[userId] = { status: 'active', timeoutId: null, lastMessage: '', mode: 'bot' };
    }
    sessions[userId].mode = mode;
    res.json({ success: true, mode: sessions[userId].mode });
});

// API Endpoint to get session status
app.get('/api/chat/status/:id', isAuthenticated, (req, res) => {
    const userId = req.params.id;
    const session = sessions[userId] || { mode: 'bot' };
    res.json({ mode: session.mode });
});

// When the client is ready, run this code (only once)
client.once('ready', () => {
    console.log('Client is ready!');
    io.emit('ready', 'WhatsApp is ready!');
});

client.on('message', async msg => {
    const userId = msg.from;
    console.log('MESSAGE RECEIVED:', userId, msg.body, mode);

    const chat = await msg.getChat();
    if (chat.isGroup || msg.from === 'status@broadcast') return;

    await loadSettings(); // Refresh settings for each message to be dynamic

    const contact = await msg.getContact();
    const pushname = contact?.pushname;
    const notelp = contact?.id?.user;
    saveHistory(userId, 'user', msg.body, notelp, pushname)

    // Initialize session if not exists
    if (!sessions[userId]) {
        sessions[userId] = {
            status: 'active',
            timeoutId: null,
            lastMessage: '',
            mode: 'bot'
        };
    }

    // If in agent mode, don't respond automatically
    if (sessions[userId].mode === 'agen') {
        console.log(`User ${userId} is in agent mode. Skipping bot response.`);
        return;
    }

    if (mode == 'ai') {
        const aiResponse = await processWithAI(userId, msg.body, pushname);
        await client.sendMessage(userId, aiResponse, {});
        saveHistory(userId, 'bot_ai', aiResponse, notelp, pushname)
    } else {
        const notAIResponse = await processMsg(userId, msg.body, pushname, sessions[userId]);
        sessions[userId] = notAIResponse[1];
        if (notAIResponse[0]) {
            await client.sendMessage(userId, notAIResponse[0], {});
            saveHistory(userId, 'bot_manual', notAIResponse[0], notelp, pushname)
            sessions[userId].lastMessage = msg.body.toLowerCase().trim();
        }

        if (sessions[userId].timeoutId) clearTimeout(sessions[userId].timeoutId);

        sessions[userId].timeoutId = setTimeout(async () => {
            const closingMessage = `Terima kasih ${pushname} telah menghubungi *Bitfast*.\nPercakapan ini kami tutup karena tidak ada aktivitas selama 1 menit. \nJika butuh bantuan lagi, jangan ragu untuk mengirim pesan kembali ya!`;
            //await sendMessageWithLog(client, userId, closingMessage);
            sessions[userId].status = 'closed';
            sessions[userId].timeoutId = null;
            //sessions[userId].count = 0;
            await client.sendMessage(userId, closingMessage, {});
            saveHistory(userId, 'bot_manual', closingMessage, notelp, pushname)
        }, TIMEOUT_DURATION);
    }
});

client.on('authenticated', (session) => {
    //console.log('AUTHENTICATED', session);
    io.emit('authenticated', 'Authenticated successfully');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    io.emit('message', 'Authentication failure');
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    io.emit('message', 'Client disconnected');
});

client.on('qr', (qr) => {
    // Generate QR for terminal
    qrcodeTerminal.generate(qr, { small: true });

    // Generate QR for web
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Error generating QR code:', err);
            return;
        }
        io.emit('qr', url);
    });
});

// Start the HTTP server
server.listen(port, () => {
    console.log(`Web interface running at http://localhost:${port}`);
});

// Start your client
loadSettings().then(() => {
    client.initialize();
});


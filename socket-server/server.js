// socket-server/server.js
const http = require('http');
const url = require('url');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 1. Create a basic HTTP server to receive triggers from PHP
const httpServer = http.createServer((req, res) => {
    // PHP will send a POST request here when data changes
    if (req.method === 'POST' && req.url === '/trigger-update') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            console.log("PHP told us to update:", body);
            try {
                const parsed = JSON.parse(body);
                // The payload from PHP should now contain entity, action, and optionally dept_id
                const { entity, action, dept_id } = parsed;

                if (!entity || !action) {
                    throw new Error('Invalid payload from PHP: missing entity or action');
                }

                // Emit via Socket.IO. If dept_id is provided, emit only to that department room.
                const payload = { entity, action, ...parsed };
                if (dept_id) {
                    io.to(`dept_${dept_id}`).emit('ENTITY_UPDATE', payload);
                } else {
                    io.emit('ENTITY_UPDATE', payload);
                }

            } catch (err) {
                console.warn('socket-server: incoming trigger body is not valid JSON or is missing fields, falling back to REFRESH_DATA', err.message);
                // Broadcast a legacy refresh event
                try {
                    io.emit('REFRESH_DATA', body);
                } catch (e) {
                    console.error('Failed to emit REFRESH_DATA', e);
                }
            }

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Notified');
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// 2. Attach Socket.IO to the HTTP server
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Authorization'],
    }
});

// Middleware to verify JWT on connection
io.use((socket, next) => {
    const token = (socket.handshake && (socket.handshake.auth && socket.handshake.auth.token)) || (socket.handshake && socket.handshake.query && socket.handshake.query.token);
    if (!token) {
        const err = new Error('Token required');
        err.data = { code: 4001 };
        return next(err);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
        // If user has a dept_id, join a department room for targeted broadcasts
        if (decoded && decoded.dept_id) {
            socket.join(`dept_${decoded.dept_id}`);
        }
        return next();
    } catch (err) {
        const e = new Error('Invalid token');
        e.data = { code: 4002 };
        return next(e);
    }
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.user ? socket.user.email : 'unknown');

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.user ? socket.user.email : 'unknown', 'reason:', reason);
    });
});

// Start listening on Port 8080
httpServer.listen(8080, () => {
    console.log('Socket.IO + HTTP Trigger running on port 8080');
});

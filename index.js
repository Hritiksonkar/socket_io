const http = require("http");
const express = require("express");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity/debugging
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.resolve("./public")));

app.get("/", (req, res) => {
    res.sendFile("/public/index.html");
});

// State Management
const users = {}; // email -> socketId
const socketToEmail = {}; // socketId -> email
const games = {}; // gameId -> game state

io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Register user
    socket.on("register", (email) => {
        const normalizedEmail = email.toLowerCase();
        users[normalizedEmail] = socket.id;
        socketToEmail[socket.id] = normalizedEmail;
        console.log(`User registered: ${normalizedEmail}`);

        // Broadcast online users
        io.emit("users_online", Object.keys(users));

        // Welcome message
        socket.emit("chat_message", {
            user: "System",
            text: `Welcome, ${normalizedEmail}!`,
            timestamp: new Date().toLocaleTimeString()
        });
    });

    // Challenge Logic
    socket.on("challenge", ({ opponentEmail }) => {
        const myEmail = socketToEmail[socket.id];
        if (!myEmail) return;

        const normalizedOpponentEmail = opponentEmail.toLowerCase();
        const opponentSocketId = users[normalizedOpponentEmail];

        if (!opponentSocketId) {
            socket.emit("challenge_error", "User not found or offline.");
            return;
        }

        if (opponentSocketId === socket.id) {
            socket.emit("challenge_error", "You cannot play against yourself.");
            return;
        }

        // Create Game
        const gameId = `${myEmail}-${normalizedOpponentEmail}-${Date.now()}`;
        games[gameId] = {
            players: {
                [myEmail]: { symbol: 'X', socketId: socket.id },
                [normalizedOpponentEmail]: { symbol: 'O', socketId: opponentSocketId }
            },
            board: Array(9).fill(null),
            turn: myEmail, // Challenger (X) starts first
            status: 'ongoing'
        };

        // Notify both players
        socket.emit("game_start", { gameId, symbol: 'X', opponent: normalizedOpponentEmail });
        io.to(opponentSocketId).emit("game_start", { gameId, symbol: 'O', opponent: myEmail });

        // Save gameId to socket for easy access
        socket.gameId = gameId;
        const opponentSocket = io.sockets.sockets.get(opponentSocketId);
        if (opponentSocket) opponentSocket.gameId = gameId;
    });

    // Handle Move
    socket.on("make_move", ({ index }) => {
        const gameId = socket.gameId;
        if (!gameId || !games[gameId]) return;

        const game = games[gameId];
        const email = socketToEmail[socket.id];

        if (game.status !== 'ongoing') return;
        if (game.turn !== email) return; // Not your turn
        if (game.board[index] !== null) return; // Invalid move

        const symbol = game.players[email].symbol;
        game.board[index] = symbol; // Update board

        // Emit move to both players
        const opponentEmail = Object.keys(game.players).find(e => e !== email);
        const opponentSocketId = game.players[opponentEmail].socketId;

        io.to(game.players[email].socketId).emit("move_made", { index, symbol });
        io.to(opponentSocketId).emit("move_made", { index, symbol });

        // Check Win/Draw
        const winner = checkWinner(game.board);
        if (winner) {
            game.status = 'finished';
            io.to(game.players[email].socketId).emit("game_over", { winner });
            io.to(opponentSocketId).emit("game_over", { winner });
        } else if (game.board.every(cell => cell !== null)) {
            game.status = 'finished';
            io.to(game.players[email].socketId).emit("game_over", { winner: 'draw' });
            io.to(opponentSocketId).emit("game_over", { winner: 'draw' });
        } else {
            // Switch Turn
            game.turn = opponentEmail;
        }
    });

    // Handle Disconnect
    socket.on("disconnect", () => {
        const email = socketToEmail[socket.id];
        if (email) {
            delete users[email];
            delete socketToEmail[socket.id];

            // Broadcast online users
            io.emit("users_online", Object.keys(users));

            // Handle active game disconnection
            if (socket.gameId && games[socket.gameId]) {
                const game = games[socket.gameId];
                const opponentEmail = Object.keys(game.players).find(e => e !== email);
                const opponentSocketId = game.players[opponentEmail]?.socketId;

                if (opponentSocketId) {
                    io.to(opponentSocketId).emit("opponent_left");
                }
                delete games[socket.gameId];
            }
        }
        console.log(`Socket disconnected: ${socket.id}`);
    });

    // Chat Logic
    socket.on("chat_message", (msg) => {
        const email = socketToEmail[socket.id];
        if (email) {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            io.emit("chat_message", { user: email, text: msg, timestamp });
        }
    });

    // Typing Indicators
    socket.on("typing", () => {
        const email = socketToEmail[socket.id];
        if (email) {
            socket.broadcast.emit("user_typing", { user: email });
        }
    });

    socket.on("stop_typing", () => {
        const email = socketToEmail[socket.id];
        if (email) {
            socket.broadcast.emit("user_stop_typing", { user: email });
        }
    });
});

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

server.listen(9000, () => {
    console.log("Server is running on port 9000");
});

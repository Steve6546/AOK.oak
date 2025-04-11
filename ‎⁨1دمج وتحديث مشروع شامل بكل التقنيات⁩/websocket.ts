// WebSocket service for real-time collaboration
// This module provides real-time collaboration features using Socket.IO

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

interface User {
  id: string;
  username: string;
  room: string;
}

interface Message {
  user: string;
  text: string;
  timestamp: number;
}

interface CodeChange {
  user: string;
  change: any; // CodeMirror change object
  timestamp: number;
}

export class WebSocketService {
  private io: Server;
  private users: Map<string, User> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // room -> set of user ids
  private roomHistory: Map<string, CodeChange[]> = new Map(); // room -> code changes history
  private roomMessages: Map<string, Message[]> = new Map(); // room -> chat messages

  constructor(server: HttpServer) {
    this.io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`New connection: ${socket.id}`);

      // Join a collaboration room
      socket.on('join', ({ username, room }) => {
        this.handleJoin(socket, username, room);
      });

      // Handle code changes
      socket.on('codeChange', (change) => {
        this.handleCodeChange(socket, change);
      });

      // Handle chat messages
      socket.on('sendMessage', (message) => {
        this.handleMessage(socket, message);
      });

      // Handle cursor position updates
      socket.on('cursorUpdate', (position) => {
        this.handleCursorUpdate(socket, position);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private handleJoin(socket: Socket, username: string, room: string): void {
    const user: User = {
      id: socket.id,
      username,
      room
    };

    // Add user to our tracking
    this.users.set(socket.id, user);

    // Add user to room
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
      this.roomHistory.set(room, []);
      this.roomMessages.set(room, []);
    }
    this.rooms.get(room).add(socket.id);

    // Join the socket room
    socket.join(room);

    // Welcome the user
    socket.emit('message', {
      user: 'system',
      text: `Welcome to the collaboration room ${room}!`,
      timestamp: Date.now()
    });

    // Notify others
    socket.broadcast.to(room).emit('message', {
      user: 'system',
      text: `${username} has joined the room`,
      timestamp: Date.now()
    });

    // Send room info
    const roomUsers = Array.from(this.rooms.get(room))
      .map(id => this.users.get(id))
      .map(user => ({ id: user.id, username: user.username }));

    this.io.to(room).emit('roomData', {
      room,
      users: roomUsers
    });

    // Send code history to the new user
    const history = this.roomHistory.get(room) || [];
    socket.emit('codeHistory', history);

    // Send message history to the new user
    const messages = this.roomMessages.get(room) || [];
    socket.emit('messageHistory', messages);
  }

  private handleCodeChange(socket: Socket, change: any): void {
    const user = this.users.get(socket.id);
    if (!user) return;

    const codeChange: CodeChange = {
      user: user.username,
      change,
      timestamp: Date.now()
    };

    // Add to history
    const history = this.roomHistory.get(user.room) || [];
    history.push(codeChange);
    this.roomHistory.set(user.room, history);

    // Broadcast to others in the room
    socket.broadcast.to(user.room).emit('codeChange', codeChange);
  }

  private handleMessage(socket: Socket, text: string): void {
    const user = this.users.get(socket.id);
    if (!user) return;

    const message: Message = {
      user: user.username,
      text,
      timestamp: Date.now()
    };

    // Add to history
    const messages = this.roomMessages.get(user.room) || [];
    messages.push(message);
    this.roomMessages.set(user.room, messages);

    // Broadcast to everyone in the room
    this.io.to(user.room).emit('message', message);
  }

  private handleCursorUpdate(socket: Socket, position: any): void {
    const user = this.users.get(socket.id);
    if (!user) return;

    // Broadcast cursor position to others in the room
    socket.broadcast.to(user.room).emit('cursorUpdate', {
      user: user.username,
      userId: socket.id,
      position,
      timestamp: Date.now()
    });
  }

  private handleDisconnect(socket: Socket): void {
    const user = this.users.get(socket.id);
    if (!user) return;

    // Remove from room
    const room = this.rooms.get(user.room);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) {
        // Clean up empty rooms
        this.rooms.delete(user.room);
        this.roomHistory.delete(user.room);
        this.roomMessages.delete(user.room);
      } else {
        // Notify others
        this.io.to(user.room).emit('message', {
          user: 'system',
          text: `${user.username} has left the room`,
          timestamp: Date.now()
        });

        // Update room data
        const roomUsers = Array.from(room)
          .map(id => this.users.get(id))
          .map(user => ({ id: user.id, username: user.username }));

        this.io.to(user.room).emit('roomData', {
          room: user.room,
          users: roomUsers
        });
      }
    }

    // Remove user
    this.users.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
  }

  // Method to get active room count
  public getActiveRoomCount(): number {
    return this.rooms.size;
  }

  // Method to get active user count
  public getActiveUserCount(): number {
    return this.users.size;
  }

  // Method to create a new collaboration room
  public createRoom(): string {
    const roomId = uuidv4();
    this.rooms.set(roomId, new Set());
    this.roomHistory.set(roomId, []);
    this.roomMessages.set(roomId, []);
    return roomId;
  }
}

export default WebSocketService;

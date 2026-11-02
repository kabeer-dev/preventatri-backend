const http = require('http');

const config = require('config');

const {socketJWTMiddleware, logger} = require('./middleware');

const {setSocket} = require('./socketInstance');

const {corsOrigins} = require('./utils');

const {sendPrivateSocketMessage} = require('./utils/socketUtils');

module.exports.prepare = ({app}) => {
  const server = http.createServer(app);

  const cors = {origin: corsOrigins, credentials: true};

  const io = setSocket({
    server,
    options: {
      cors,
    },
  });

  io.use(socketJWTMiddleware);

  if (config.get('env') !== config.get('envVariables.test')) {
    const PORT = config.get('port') || 3001;

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server is listening on port ${PORT}`);
    });
  }

  io.on('connection', (socket) => {
    const organizationId = socket.organizationId;
    const userId = socket.userId;

    if (!organizationId) return;

    socket.join(organizationId);
    if (userId) socket.join(`user:${userId}`);

    // Send a private socket message to all clients in the specified organization room
    sendPrivateSocketMessage({
      data: 'Hello from server',
      event: 'message',
      room: organizationId,
    });

    socket.on('disconnect', () => {
      socket.leave(organizationId);
      if (userId) socket.leave(`user:${userId}`);
    });
  });

  return io;
};

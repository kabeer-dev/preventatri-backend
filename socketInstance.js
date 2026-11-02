const {Server} = require('socket.io');

let io = null;

const setSocket = ({server, options}) => {
  if (io)
    throw new Error(
      'Socket instance already exists. Use getSocket() to retrieve it.'
    );

  if (!server) throw new Error('Server parameter is required');

  io = new Server(server, options);

  return io;
};

const getSocket = () => {
  if (!io)
    throw new Error('Socket instance not initialized. Call setSocket() first.');

  return io;
};

module.exports = {setSocket, getSocket};

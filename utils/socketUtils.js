const {getSocket} = require('../socketInstance');

const sendPrivateSocketMessage = ({room, event, data}) => {
  const socket = getSocket();
  if (socket) socket.to(room).emit(event, data);
};

module.exports = {
  sendPrivateSocketMessage,
};

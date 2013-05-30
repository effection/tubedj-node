app.factory('Socket', function ($rootScope) {
  var socket = io.connect('http://192.168.0.6:8081');
  return {
    on: function (eventName, callback) {
      socket.on(eventName, function () {  
        var args = arguments;
        $rootScope.$apply(function () {
          callback.apply(socket, args);
        });
      });
    },
    emit: function (eventName, data, callback) {
      socket.emit(eventName, data, function () {
        var args = arguments;
        $rootScope.$apply(function () {
          if (callback) {
            callback.apply(socket, args);
          }
        });
      })
    },
    disconnect: function() {
    	socket.disconnect();
    },
    reconnect: function() {
    	socket = io.connect('http://192.168.0.6:8081');
    }
  };
});
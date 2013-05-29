app.controller('PlaylistController', ['$scope', , 'Restangular' function PlaylistController($scope, Restangular) {
	var roomId = $scope.GlobalState.room.id;
	var room = Restangular.one('rooms', roomId);

	$scope.playlist = room.all('playlist').getList();

	
}]);
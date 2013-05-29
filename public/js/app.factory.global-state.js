app.factory('GlobalStateService', function()
{
	/**
	 * Added to $rootScope to provide easy access to user & room details from controllers
	 */
	return {
		options: {

		},

		user: {
			exists: false,
			id: null,
			name: null
		},

		room: {
			id: null
		}
	};
});

app.run(['$rootScope', 'GlobalStateService', function ($rootScope, GlobalStateService) {
    $rootScope.GlobalState = GlobalStateService;
}]);
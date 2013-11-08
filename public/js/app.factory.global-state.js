app.factory('GlobalStateService', function()
{
	/**
	 * Added to $rootScope to provide easy access to user & room details from controllers
	 */
	var service = function(){
		var self = this;

		this.options = {

		};

		this.user = {
			exists: false,
			id: null,
			name: null
		};

		this.room = {
			id: null
		};


		function loadAndCheckUserDetails() {
			var response = null;
			if(response && response.exists) {
				self.user.exists = true;
				self.user.id = response.id;
				self.user.name = response.name;
			} else {
				self.user.exists = false;
				self.user.id = '';
				self.user.name = 'Browser';
			}
		}

		loadAndCheckUserDetails();
	};

	return new service();
});

app.run(['$rootScope', 'GlobalStateService', function ($rootScope, GlobalStateService) {
    $rootScope.GlobalState = GlobalStateService;
}]);
app.directive('jqTimeago', function () {
    return {
		restrict: 'A',
		link: function (scope, element, attrs) {
			attrs.$observe('jqTimeago', function(value) {
				if (value) {
					var date = jQuery.timeago(value);
					element.text(date);
				}
			});
		}
	};
});   
'use strict';

app.controller('SearchController', ['$scope', 'youtubeService', function SearchController($scope, youtubeService)
{
	$scope.items = [];
	$scope.isSearching = false;
	$scope.isGettingMoreResults = false;
    $scope.hasError = false;
	
	$scope._lastSearch = null;
	
    function onSearchSubmitError()
    {
		$scope.isGettingMoreResults = false;
		$scope.isSearching = false;
        $scope.hasError = true;
		//Put startIndex back to original value
		$scope._lastSearch.startIndex -= $scope._lastSearch.resultsCount;
    }

    function onSearchSubmitSuccess(items)
    {
		$scope.isGettingMoreResults = false;
		$scope.isSearching = false;
        $scope.hasError = false;

        $scope.items = $scope.items.concat(items);
		
		$scope._lastSearch.resultsCount = items.length;
    }


    $scope.onSearchSubmit = function()
    {
		//Reset results
		$scope.items = [];
		
		$scope._lastSearch = {q: $scope.varSearch, startIndex: 1};
		
		$scope.isSearching = true;
        youtubeService.search($scope._lastSearch).then(onSearchSubmitSuccess, onSearchSubmitError);
    }
	
	$scope.getMoreResults = function() {
		if(!$scope._lastSearch) {
			return;	
		}
		
		$scope.isGettingMoreResults = true;
		
		$scope._lastSearch.startIndex = $scope._lastSearch.startIndex + $scope._lastSearch.resultsCount;
		
		youtubeService.search({ q: $scope._lastSearch.q, startIndex: $scope._lastSearch.startIndex }).then(onSearchSubmitSuccess, onSearchSubmitError);
	}
}]);
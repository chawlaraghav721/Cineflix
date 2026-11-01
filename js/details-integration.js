(function () {
    "use strict";

    const catalogueApi = window.CineFlixCatalogue;
    const details = window.CineFlixDetails;
    const myList = window.CineFlixMyList;

    function refreshMyListConnection() {
        // Reconnect to refresh only the button, leaving the poster and modal alone.
        details.connectMyList(myList);
    }

    refreshMyListConnection();
    window.addEventListener("cineflix:list-updated", refreshMyListConnection);
    window.addEventListener("pageshow", refreshMyListConnection);

    async function loadDetails() {
        const id = details.getSelectedId();
        if (!id || !id.trim()) {
            details.showError("No title ID was provided. Browse the catalogue to choose a movie or TV show.");
            return;
        }

        details.showLoading();
        try {
            const catalogue = await catalogueApi.loadCatalogue();
            const item = catalogueApi.getItemById(catalogue, id);
            if (!item) {
                details.showError("This title is unavailable. Browse the catalogue to find another movie or TV show.");
                return;
            }
            details.render(item);
        } catch (error) {
            details.showError("Title details could not be loaded. Check your connection and refresh the page to try again.");
        }
    }

    loadDetails();
}());

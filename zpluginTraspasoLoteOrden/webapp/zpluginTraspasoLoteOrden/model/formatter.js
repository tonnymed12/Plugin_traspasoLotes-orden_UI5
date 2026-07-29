sap.ui.define([], function () {
    "use strict";
    return {
        getMaterial: function (sValue) {
            if (!sValue) { return ""; }
            return sValue.split("!")[0] || "";
        },
        getLote: function (sValue) {
            if (!sValue) { return ""; }
            return sValue.split("!")[1] || "";
        },
        getSecuencia: function (sValue) {
            if (!sValue) { return ""; }
            return sValue.split("!")[2] || "";
        },
        // Formats ISO date string to local readable date
        formatDate: function (sDate) {
            if (!sDate) { return ""; }
            return new Date(sDate).toLocaleDateString();
        },
        // Maps order status key to state for ObjectStatus
        orderStatusState: function (sStatus) {
            var mMap = { "NEW": "None", "RELEASED": "Success", "HOLD": "Warning", "DONE": "None", "CLOSED": "None" };
            return mMap[sStatus] || "None";
        }
    };
});

sap.ui.define([
    "sap/m/MessageBox"
], function (MessageBox) {
    "use strict";

    return {
        /**
         * Generic AJAX wrapper — same pattern as PluginPutBatchWCNB Commons.
         * @param {string}   sUri         Full URL
         * @param {string}   sType        HTTP verb
         * @param {*}        sData        Request body (stringified when needed)
         * @param {function} fCallBack    Success callback
         * @param {function} fErrCallback Error callback
         */
        consumeApi: function (sUri, sType, sData, fCallBack, fErrCallback) {
            $.ajax({
                type: sType,
                url: sUri,
                data: sData,
                contentType: "application/json",
                async: false
            }).then(
                function (data) {
                    if (fCallBack) { fCallBack(data); }
                },
                function (data) {
                    var sMsg = "Request error";
                    if (data && data.responseJSON) {
                        sMsg = data.responseJSON.message || data.responseJSON.displayMessage || sMsg;
                    }
                    MessageBox.error(sMsg);
                    if (fErrCallback) { fErrCallback(data); }
                }
            );
        },

        consumeApiJson: function (sUri, sType, oData, fCallBack, fErrCallback) {
            this.consumeApi(sUri, sType, JSON.stringify(oData), fCallBack, fErrCallback);
        }
    };
});

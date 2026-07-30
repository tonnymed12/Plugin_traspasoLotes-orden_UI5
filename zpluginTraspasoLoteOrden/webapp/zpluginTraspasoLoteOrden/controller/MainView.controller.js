sap.ui.define([
    "jquery.sap.global",
    "sap/dm/dme/podfoundation/controller/PluginViewController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "./Utils/ApiPaths",
    "../model/formatter"
], function (jQuery, PluginViewController, JSONModel, MessageBox, MessageToast, ApiPaths, formatter) {
    "use strict";

    // Slot prefix used by the NB scanning plugin to store MATERIAL!LOTE!SECUENCIA
    var SLOT_PREFIX = "SLOT";

    return PluginViewController.extend(
        "serviacero.custom.plugins.zpluginTraspasoLoteOrden.zpluginTraspasoLoteOrden.controller.MainView", {

        ApiPaths: ApiPaths,
        formatter: formatter,

        // ─── Lifecycle ────────────────────────────────────────────────────────────

        onInit: function () {
            PluginViewController.prototype.onInit.apply(this, arguments);

            this.getView().setModel(new JSONModel({ items: [] }), "lotesOrigen");
            this.getView().setModel(new JSONModel({ items: [], ordenSeleccionada: false }), "ordenes");

            this._oOrdenDestino = null; // orden row seleccionada
        },

        onAfterRendering: function () {
            var oCfg = this.getConfiguration();
            this.getView().byId("backButton").setVisible(oCfg.backButtonVisible);
            this.getView().byId("closeButton").setVisible(oCfg.closeButtonVisible);
            this.getView().byId("headerTitle").setText(oCfg.title);

            this._cargarLotesOrigen();
        },

        onBeforeRenderingPlugin: function () {
            // reservado para uso futuro
        },

        onExit: function () {
            PluginViewController.prototype.onExit.apply(this, arguments);
        },

        // ─── Carga de lotes de la operación origen ────────────────────────────────

        /**
         * Obtiene los custom values (SLOT*) de la operationActivity actual
         * y los puebla en el modelo "lotesOrigen".
         */
        _cargarLotesOrigen: function () {
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sUrl = oSapApi + ApiPaths.OPERATION_ACTIVITIES;
            // Same pattern as NB plugin: source OA is read by plant+operation only
            var oParams = {
                plant: oPODParams.PLANT_ID,
                operation: oPODParams.OPERATION_ACTIVITY
            };

            this.ajaxGetRequest(sUrl, oParams, function (oRes) {
                var aContent = (oRes && oRes.content) || [];
                var oData = aContent[0];
                if (!oData || !oData.customValues) { return; }

                var aLotes = this._extraerLotesDeCustomValues(oData.customValues);
                this.getView().getModel("lotesOrigen").setProperty("/items", aLotes);
                this._oOperationActivityData = oData; // guardamos para el traspaso
            }.bind(this));
        },

        /**
         * Transforma los customValues con prefix SLOT* en objetos planos
         * { atributo, material, lote, secuencia, cantidad, uom }.
         */
        _extraerLotesDeCustomValues: function (aCustomValues) {
            return aCustomValues
                .filter(function (cv) {
                    return cv.attribute && cv.attribute.startsWith(SLOT_PREFIX) &&
                        cv.value && cv.value.trim() !== "";
                })
                .map(function (cv) {
                    var aParts = cv.value.split("!");
                    return {
                        atributo: cv.attribute,
                        material: aParts[0] || "",
                        lote: aParts[1] || "",
                        secuencia: aParts[2] || "",
                        cantidad: cv.loteQty || "",
                        uom: cv.loteUom || ""
                    };
                });
        },

        onRefreshLotesOrigen: function () {
            this._cargarLotesOrigen();
        },

        // ─── Búsqueda de órdenes destino ─────────────────────────────────────────

        onBuscarOrdenes: function () {
            var oView = this.getView();
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var sOrden       = oView.byId("inputOrden").getValue().trim();
            var sFechaDesde  = oView.byId("dpFechaDesde").getValue();
            var sFechaHasta  = oView.byId("dpFechaHasta").getValue();
            var sTipo        = oView.byId("selTipo").getSelectedKey();
            var sStatus      = oView.byId("selStatus").getSelectedKey();

            var oParams = { plant: oPODParams.PLANT_ID, size: 50 };
            if (sOrden)      { oParams.order = sOrden; }
            if (sFechaDesde) { oParams.createdDateTimeFrom = sFechaDesde + "T00:00:00"; }
            if (sFechaHasta) { oParams.createdDateTimeTo   = sFechaHasta + "T23:59:59"; }
            if (sTipo)       { oParams.orderType = sTipo; }
            if (sStatus)     { oParams.status    = sStatus; }

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sUrl = oSapApi + ApiPaths.ORDERS;

            this.ajaxGetRequest(sUrl, oParams, function (oRes) {
                var aContent = (oRes && oRes.content) || [];
                var oOrdenesModel = this.getView().getModel("ordenes");
                oOrdenesModel.setProperty("/items", aContent);
                oOrdenesModel.setProperty("/ordenSeleccionada", false);
                this._oOrdenDestino = null;

                if (aContent.length === 0) {
                    var oBundle = this.getView().getModel("i18n").getResourceBundle();
                    MessageToast.show(oBundle.getText("noOrdenesEncontradas"));
                }
            }.bind(this));
        },

        onOrdenSelectionChange: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (!oItem) { return; }

            var oCtx = oItem.getBindingContext("ordenes");
            this._oOrdenDestino = oCtx ? oCtx.getObject() : null;

            this.getView().getModel("ordenes")
                .setProperty("/ordenSeleccionada", !!this._oOrdenDestino);
        },

        // ─── Traspaso de lotes ────────────────────────────────────────────────────

        onTraspasar: function () {
            if (!this._oOrdenDestino) { return; }

            var aLotesOrigen = this.getView().getModel("lotesOrigen").getProperty("/items");
            if (!aLotesOrigen || aLotesOrigen.length === 0) {
                var oBundle = this.getView().getModel("i18n").getResourceBundle();
                MessageBox.warning(oBundle.getText("sinLotesParaTraspasar"));
                return;
            }

            var oOrden = this._oOrdenDestino;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            MessageBox.confirm(
                oBundle.getText("confirmarTraspaso", [aLotesOrigen.length, oOrden.order]),
                {
                    title: oBundle.getText("confirmarTraspaso.title"),
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            this._ejecutarTraspaso(aLotesOrigen, oOrden);
                        }
                    }.bind(this)
                }
            );
        },

        /**
         * Obtiene la primera operationActivity de una orden. Devuelve Promise<operationActivity>.
         */
        _getOperationActivityForOrder: function (sPlant, sOrder) {
            var oSapApi = this.getPublicApiRestDataSourceUri();
            return new Promise(function (resolve, reject) {
                this.ajaxGetRequest(
                    oSapApi + ApiPaths.OPERATION_ACTIVITIES,
                    { plant: sPlant, order: sOrder },
                    function (oRes) {
                        var aOps = (oRes && oRes.content) || [];
                        if (aOps.length === 0) { reject("no_ops"); return; }
                        resolve(aOps[0]);
                    }.bind(this),
                    function (oErr) { reject(oErr); }.bind(this)
                );
            }.bind(this));
        },

        /**
         * Persiste customValues en una operationActivity via PP — mismo patrón que el plugin NB.
         * @param {Object} oOAData  operationActivity del backend (plant, operation, version)
         * @param {Array}  aCustomValues  array de { attribute, value }
         */
        _setOperationActivityCustomValues: function (oOAData, aCustomValues) {
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oPayload = {
                inData: [{
                    plant: oOAData.plant,
                    operation: oOAData.operation,
                    version: oOAData.version || "",
                    customValues: aCustomValues
                }]
            };
            return new Promise(function (resolve, reject) {
                this.ajaxPostRequest(
                    oSapApi + ApiPaths.putBatchSlotOperationActivity,
                    oPayload,
                    function (oRes) { resolve(oRes); }.bind(this),
                    function (oErr) { reject(oErr); }.bind(this)
                );
            }.bind(this));
        },

        _ejecutarTraspaso: function (aLotesOrigen, oOrdenDestino) {
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            this._getOperationActivityForOrder(oPODParams.PLANT_ID, oOrdenDestino.order)
                .then(function (oOpDestino) {
                    return this._copiarSlotsEnOperacion(aLotesOrigen, oOpDestino, oOrdenDestino, oBundle);
                }.bind(this))
                .catch(function (oErr) {
                    if (oErr === "no_ops") {
                        MessageBox.error(oBundle.getText("errorSinOperacionDestino", [oOrdenDestino.order]));
                    } else {
                        MessageBox.error(oBundle.getText("errorTraspaso"));
                    }
                });
        },

        /**
         * Construye el payload de customValues con formato MATERIAL!LOTE!SECUENCIA
         * y lo persiste en la operationActivity destino via ajaxPostRequest al PP.
         */
        _copiarSlotsEnOperacion: function (aLotesOrigen, oOpDestino, oOrdenDestino, oBundle) {
            var aCustomValuesDestino = (oOpDestino.customValues || []).slice();

            aLotesOrigen.forEach(function (oLote, iIdx) {
                // Format matches NB plugin: SLOT001, SLOT002...
                var sAtributo = SLOT_PREFIX + (iIdx + 1).toString().padStart(3, "0");
                var sValor    = oLote.material + "!" + oLote.lote + "!" + (iIdx + 1);

                var oExistente = aCustomValuesDestino.find(function (cv) { return cv.attribute === sAtributo; });
                if (oExistente) {
                    oExistente.value = sValor;
                } else {
                    aCustomValuesDestino.push({ attribute: sAtributo, value: sValor });
                }
            });

            // OA no necesita SLOTQTY en el payload (solo existe a nivel WC)
            return this._setOperationActivityCustomValues(oOpDestino, aCustomValuesDestino)
                .then(function () {
                    MessageToast.show(oBundle.getText("traspasoExitoso", [aLotesOrigen.length, oOrdenDestino.order]));
                    this._cargarLotesOrigen();
                    this.getView().getModel("ordenes").setProperty("/ordenSeleccionada", false);
                    this._oOrdenDestino = null;
                }.bind(this))
                .catch(function (oErr) {
                    var sMsg = (oErr && oErr.responseJSON &&
                        (oErr.responseJSON.message || oErr.responseJSON.displayMessage)) ||
                        oBundle.getText("errorTraspaso");
                    MessageBox.error(sMsg);
                });
        },

        // ─── Helpers ──────────────────────────────────────────────────────────────

        // Same access pattern as NB Commons.getPODParams
        _getPODParams: function () {
            try {
                var oModels = this.getOwnerComponent().oPropagatedProperties.oModels;
                var oData = oModels.podSelectionModel.oData;
                var sOrderRef = oData.selectedOrderData.orderRef || "";
                var sPlant = String(String(sOrderRef).split(":")[1]).split(",")[0];
                var sOrder = oData.selectedOrderData.order || "";
                var sOperation = oData.selectedPhaseData.operation.operation || "";
                if (!sPlant || !sOperation) { return null; }
                return { PLANT_ID: sPlant, ORDER_ID: sOrder, OPERATION_ACTIVITY: sOperation };
            } catch (e) {
                console.error("[Traspaso] _getPODParams error:", e);
                return null;
            }
        },

        isSubscribingToNotifications: function () { return false; },
        getCustomNotificationEvents: function () {},
        getNotificationMessageHandler: function () { return null; }
    });
});

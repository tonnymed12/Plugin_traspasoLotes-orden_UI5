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
        },

        onBeforeRenderingPlugin: function () {
            // POD context is available here (not yet in onAfterRendering)
            this._cargarLotesOrigen();
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
                this._oOperationActivityData = oData;
                this._enriquecerLotesConStock(aLotes, oPODParams);
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

        /**
         * Consulta inventory/v2/inventory (POST) para obtener stock disponible de cada lote.
         * Actualiza cantidad y uom en el modelo lotesOrigen.
         */
        _enriquecerLotesConStock: function (aLotes, oPODParams) {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sUrl = oSapApi + ApiPaths.INVENTORIES_V2;

            // Poblar tabla de inmediato con los lotes sin cantidad mientras carga el stock
            oView.getModel("lotesOrigen").setProperty("/items", aLotes);

            if (aLotes.length === 0) { return; }

            var aPromesas = aLotes.map(function (oLote) {
                var oBody = {
                    plant: oPODParams.PLANT_ID,
                    material: oLote.material,
                    batchNumber: oLote.lote,
                    status: "UNRESTRICTED"
                };
                return new Promise(function (resolve) {
                    this.ajaxPostRequest(sUrl, oBody,
                        function (oRes) {
                            var aItems = (oRes && oRes.content) || (Array.isArray(oRes) ? oRes : []);
                            // Solo stock libre (sin reserva de orden)
                            var oItem = aItems.find(function (i) { return i.reservedOrder === null; });
                            if (oItem && oItem.quantityOnHand) {
                                oLote.cantidad = oItem.quantityOnHand.value != null ? oItem.quantityOnHand.value : "";
                                oLote.uom = oItem.quantityOnHand.internalUnitOfMeasure || "";
                            }
                            resolve();
                        }.bind(this),
                        function () { resolve(); } // stock no bloquea si falla
                    );
                }.bind(this));
            }.bind(this));

            Promise.all(aPromesas).then(function () {
                oView.getModel("lotesOrigen").refresh(true);
            });
        },

        // ─── Búsqueda de órdenes destino ─────────────────────────────────────────

        onBuscarOrdenes: function () {
            var oView = this.getView();
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var sOrden = oView.byId("inputOrden").getValue().trim();
            if (!sOrden) {
                var oBundle = this.getView().getModel("i18n").getResourceBundle();
                MessageToast.show(oBundle.getText("filtro.orden.requerido"));
                return;
            }

            var oParams = { plant: oPODParams.PLANT_ID, order: sOrden };

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sUrl = oSapApi + ApiPaths.ORDERS;

            this.ajaxGetRequest(sUrl, oParams, function (oRes) {
                // GET /v1/orders returns a single object, not a paginated content[]
                var aContent = oRes && oRes.content ? oRes.content : (oRes && oRes.order ? [oRes] : []);
                var oOrdenesModel = this.getView().getModel("ordenes");
                oOrdenesModel.setProperty("/items", aContent);
                oOrdenesModel.setProperty("/ordenSeleccionada", false);
                this._oOrdenDestino = null;
                oView.byId("inputOrden").setValue("");

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
        // Obtiene la operacion de la orden destino via SFC detail (O(1), sin paginacion)
        _getOperationActivityForOrder: function (sPlant, oOrdenDestino) {
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sSfc = oOrdenDestino.sfcs && oOrdenDestino.sfcs[0];
            if (!sSfc) { return Promise.reject("no_sfc"); }

            return new Promise(function (resolve, reject) {
                this.ajaxGetRequest(
                    oSapApi + ApiPaths.SFC_DETAIL,
                    { plant: sPlant, sfc: sSfc },
                    function (oRes) {
                        var aSteps = (oRes && oRes.steps) || [];
                        var sOperation = aSteps.length > 0 &&
                            aSteps[0].operation && aSteps[0].operation.operation;
                        if (!sOperation) { reject("no_ops"); return; }
                        resolve({ operation: sOperation });
                    }.bind(this),
                    function (oErr) { reject(oErr); }.bind(this)
                );
            }.bind(this));
        },

        _ejecutarTraspaso: function (aLotesOrigen, oOrdenDestino) {
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oView = this.getView();

            oView.byId("panelPlugin").setBusy(true);

            this._validarMaterialesCompatibles(aLotesOrigen, oPODParams, oOrdenDestino)
                .then(function () {
                    return this._getOperationActivityForOrder(oPODParams.PLANT_ID, oOrdenDestino);
                }.bind(this))
                .then(function (oOpDestino) {
                    var oPayload = {
                        inPlanta: oPODParams.PLANT_ID,
                        inOperacionOrigen: oPODParams.OPERATION_ACTIVITY,
                        inOperacionDestino: oOpDestino.operation
                    };
                    return new Promise(function (resolve, reject) {
                        this.ajaxPostRequest(
                            oSapApi + ApiPaths.traspasoLotes,
                            oPayload,
                            function (oRes) { resolve(oRes); }.bind(this),
                            function (oErr) { reject(oErr); }.bind(this)
                        );
                    }.bind(this));
                }.bind(this))
                .then(function (oRes) {
                    oView.byId("panelPlugin").setBusy(false);

                    var bOk = oRes && (oRes.outStatus === "true" || oRes.outStatus === true);

                    if (!bOk) {
                        MessageBox.error((oRes && oRes.outMensaje) || oBundle.getText("errorTraspaso"));
                        return;
                    }

                    // outConfirmation is StringArray; element 0 is a JSON string
                    var oConfirm = null;
                    try {
                        var aConf = oRes.outConfirmation || [];
                        if (aConf.length > 0) { oConfirm = JSON.parse(aConf[0]); }
                    } catch (e) { /* fallback to i18n if parse fails */ }

                    var iTransferred = oConfirm ? oConfirm.slotsTransferred : aLotesOrigen.length;
                    MessageToast.show(oBundle.getText("traspasoExitoso", [iTransferred, oOrdenDestino.order]));

                    this._cargarLotesOrigen();
                    this.getView().getModel("ordenes").setProperty("/items", []);
                    this.getView().getModel("ordenes").setProperty("/ordenSeleccionada", false);
                    this._oOrdenDestino = null;
                }.bind(this))
                .catch(function (oErr) {
                    oView.byId("panelPlugin").setBusy(false);
                    if (oErr === "no_ops" || oErr === "no_sfc") {
                        MessageBox.error(oBundle.getText("errorSinOperacionDestino", [oOrdenDestino.order]));
                    } else if (oErr && oErr.materialIncompatible) {
                        MessageBox.error(oErr.mensaje || oBundle.getText("errorMaterialIncompatible", [oErr.material]));
                    } else {
                        var sMsg = (oErr && oErr.responseJSON &&
                            (oErr.responseJSON.message || oErr.responseJSON.displayMessage)) ||
                            oBundle.getText("errorTraspaso");
                        MessageBox.error(sMsg);
                    }
                }.bind(this));
        },

        /**
         * Valida cada material unico de aLotesOrigen contra los componentes NORMAL
         * de la orden destino via PP validateMaterialEnOrden. Rechaza al primer material incompatible.
         */
        _validarMaterialesCompatibles: function (aLotesOrigen, oPODParams, oOrdenDestino) {
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var aMateriales = aLotesOrigen
                .map(function (o) { return o.material; })
                .filter(function (sMaterial, iIdx, aArr) { return sMaterial && aArr.indexOf(sMaterial) === iIdx; });

            var aPromesas = aMateriales.map(function (sMaterial) {
                var oBody = {
                    inPlanta: oPODParams.PLANT_ID,
                    inOrden: oOrdenDestino.order,
                    inMaterial: sMaterial
                };
                return new Promise(function (resolve, reject) {
                    this.ajaxPostRequest(
                        oSapApi + ApiPaths.validateMaterialEnOrden,
                        oBody,
                        function (oRes) {
                            var bOk = oRes && (oRes.outMaterial === true || oRes.outMaterial === "true");
                            if (!bOk) {
                                reject({ materialIncompatible: true, material: sMaterial, mensaje: oRes && oRes.outMensaje });
                                return;
                            }
                            resolve();
                        }.bind(this),
                        function (oErr) { reject(oErr); }.bind(this)
                    );
                }.bind(this));
            }.bind(this));

            return Promise.all(aPromesas);
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
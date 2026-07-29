sap.ui.define([
    "jquery.sap.global",
    "sap/dm/dme/podfoundation/controller/PluginViewController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "./Utils/Commons",
    "./Utils/ApiPaths",
    "../model/formatter"
], function (jQuery, PluginViewController, JSONModel, MessageBox, MessageToast, Commons, ApiPaths, formatter) {
    "use strict";

    // Slot prefix used by the NB scanning plugin to store MATERIAL!LOTE!SECUENCIA
    var SLOT_PREFIX = "SLOT";
    var SLOT_QTY_ATTR = "SLOTQTY";
    var SLOT_TIPO_ATTR = "SLOTTIPO";

    return PluginViewController.extend(
        "serviacero.custom.plugins.zpluginTraspasoLoteOrden.zpluginTraspasoLoteOrden.controller.MainView", {

        Commons: Commons,
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
                        cv.attribute !== SLOT_QTY_ATTR &&
                        cv.attribute !== SLOT_TIPO_ATTR &&
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
         * Busca la operationActivity de la orden destino y copia los slots.
         * Hoy usa ORDER_CUSTOM_VALUES; cuando el proceso de traspaso esté disponible,
         * reemplazar por ApiPaths.traspasoLotes.
         */
        _ejecutarTraspaso: function (aLotesOrigen, oOrdenDestino) {
            var oPODParams = this._getPODParams();
            if (!oPODParams) { return; }

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            // 1. Obtener la primera operación de la orden destino
            this.ajaxGetRequest(
                oSapApi + ApiPaths.OPERATION_ACTIVITIES,
                { plant: oPODParams.PLANT_ID, order: oOrdenDestino.order },
                function (oRes) {
                    var aOps = (oRes && oRes.content) || [];
                    if (aOps.length === 0) {
                        MessageBox.error(oBundle.getText("errorSinOperacionDestino", [oOrdenDestino.order]));
                        return;
                    }

                    var oOpDestino = aOps[0];
                    this._copiarSlotsEnOperacion(aLotesOrigen, oOpDestino, oOrdenDestino, oPODParams, oSapApi, oBundle);
                }.bind(this)
            );
        },

        /**
         * Construye el payload de customValues y lo envía via PATCH a la operación destino.
         * El formato de value es MATERIAL!LOTE!SECUENCIA, igual que en el plugin NB.
         */
        _copiarSlotsEnOperacion: function (aLotesOrigen, oOpDestino, oOrdenDestino, oPODParams, oSapApi, oBundle) {
            var aCustomValuesDestino = (oOpDestino.customValues || []).slice(); // copia para no mutar

            aLotesOrigen.forEach(function (oLote, iIdx) {
                var sAtributo  = SLOT_PREFIX + (iIdx + 1);
                var sValor     = oLote.material + "!" + oLote.lote + "!" + (iIdx + 1);

                // Buscar si ya existe el atributo en destino para actualizarlo
                var oExistente = aCustomValuesDestino.find(function (cv) { return cv.attribute === sAtributo; });
                if (oExistente) {
                    oExistente.value = sValor;
                } else {
                    aCustomValuesDestino.push({ attribute: sAtributo, value: sValor });
                }
            });

            // Actualizar SLOTQTY con la cantidad de lotes traspasados
            var oSlotQty = aCustomValuesDestino.find(function (cv) { return cv.attribute === SLOT_QTY_ATTR; });
            if (oSlotQty) {
                oSlotQty.value = String(aLotesOrigen.length);
            } else {
                aCustomValuesDestino.push({ attribute: SLOT_QTY_ATTR, value: String(aLotesOrigen.length) });
            }

            var oPayload = {
                plant: oPODParams.PLANT_ID,
                order: oOrdenDestino.order,
                operation: oOpDestino.operation,
                stepId: oOpDestino.stepId || "*",
                customValues: aCustomValuesDestino
            };

            Commons.consumeApiJson(
                oSapApi + ApiPaths.ORDER_CUSTOM_VALUES,
                "PATCH",
                oPayload,
                function () {
                    MessageToast.show(oBundle.getText("traspasoExitoso", [aLotesOrigen.length, oOrdenDestino.order]));
                    // Refrescar panel origen tras el traspaso exitoso
                    this._cargarLotesOrigen();
                    this.getView().getModel("ordenes").setProperty("/ordenSeleccionada", false);
                    this._oOrdenDestino = null;
                }.bind(this),
                function () {
                    MessageBox.error(oBundle.getText("errorTraspaso"));
                }
            );
        },

        // ─── Helpers ──────────────────────────────────────────────────────────────

        _getPODParams: function () {
            var oPODSelectionContext = this.getPodSelectionContext ? this.getPodSelectionContext() : null;
            if (!oPODSelectionContext) { return null; }
            return {
                PLANT_ID: oPODSelectionContext.getPlant ? oPODSelectionContext.getPlant() : (oPODSelectionContext.plant || ""),
                OPERATION_ACTIVITY: oPODSelectionContext.getOperationActivity
                    ? oPODSelectionContext.getOperationActivity()
                    : (oPODSelectionContext.operationActivity || "")
            };
        },

        isSubscribingToNotifications: function () { return false; },
        getCustomNotificationEvents: function () {},
        getNotificationMessageHandler: function () { return null; }
    });
});

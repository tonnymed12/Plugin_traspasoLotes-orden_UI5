sap.ui.define([], function () {
    "use strict";
    return {
        /** GET */
        ORDERS: "order/v1/orders",
        OPERATION_ACTIVITIES: "operationActivity/v1/operationActivities",
        WORKCENTERS: "workcenter/v2/workcenters",

        /** PATCH */
        ORDER_CUSTOM_VALUES: "order/v1/orders/customValues",

        /** Production Process — ajusta la key cuando tengas el proceso de traspaso */
        getLotesOperacion: "/pe/api/v1/process/processDefinitions/start?key=REG_PENDIENTE_getLotesOperacion&async=false",
        traspasoLotes:     "/pe/api/v1/process/processDefinitions/start?key=REG_PENDIENTE_traspasoLotes&async=false"
    };
});

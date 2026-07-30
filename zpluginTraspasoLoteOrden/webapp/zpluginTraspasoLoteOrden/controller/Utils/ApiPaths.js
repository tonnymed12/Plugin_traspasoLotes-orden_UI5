sap.ui.define([], function () {
    "use strict";
    return {
        /** GET */
        ORDERS: "order/v1/orders",
        OPERATION_ACTIVITIES: "operationActivity/v1/operationActivities",
        WORKCENTERS: "workcenter/v2/workcenters",

        /** POST */
        // queryInventoriesUsingPost_V2 — stock disponible por planta/material/lote
        INVENTORIES_V2: "inventory/v2/inventory",

        /** Production Process — POST via ajaxPostRequest */
        // Persiste customValues en una operationActivity (mismo PP que usa el plugin NB)
        putBatchSlotOperationActivity: "/pe/api/v1/process/processDefinitions/start?key=REG_186243f5-3d68-45df-b30f-515331cb0fab&async=false",

        // Reemplazar key cuando esté disponible el proceso dedicado de traspaso
        traspasoLotes: "/pe/api/v1/process/processDefinitions/start?key=REG_PENDIENTE_traspasoLotes&async=false"
    };
});

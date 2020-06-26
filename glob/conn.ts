import { ENV_DB_CONFIG } from './env'

// ************ CONFIGS ************

export class AppConnections {

    constructor() {

    }

    async configureConnections(dbConfig: ENV_DB_CONFIG) {
    }
}

const CONN = new AppConnections();
export default CONN;


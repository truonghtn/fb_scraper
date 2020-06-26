export interface ENV_DB_CONFIG {
    REDIS: any;
}

export interface ENV_KONG_CONFIG {
    MY_HOST: string;
    PROVISION: string;
    ADMIN_HOST: string;
    REDIRECT_HOST: string;
}

export interface ENV_CONFIG {
    NAME: string;
    HTTP_PORT: number;
    DB: ENV_DB_CONFIG;
    KONG: ENV_KONG_CONFIG;
}

export const ENV: ENV_CONFIG = require(process.env.config || '../env.json');
export default ENV;
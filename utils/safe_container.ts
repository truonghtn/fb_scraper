export class SafeContainer<T> {
    private factoringPromise: Promise<void>;

    obj: T;
    expiredAt: number;

    constructor(private factory: () => Promise<T>, private expires: number) {

    }

    private async renewObj() {
        try {
            this.factoringPromise = (async () => {
                this.obj = null;
                this.obj = await this.factory();
                this.expiredAt = Date.now() + this.expires;
            })();
            await this.factoringPromise;
        }
        finally {
            this.factoringPromise = undefined;
        }
    }

    async acquire(): Promise<T> {
        if (this.factoringPromise) {
            await this.factoringPromise;
        }
        else if (this.obj == null || this.expiredAt <= Date.now()) {
            await this.renewObj();
        }

        return this.obj;
    }

    release() {
        if (!this.factoringPromise) {
            this.obj = null;
        }
    }
}

export default SafeContainer;
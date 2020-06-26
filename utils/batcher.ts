
export function batch<T>(nMax: number, timeout: number, handler: (args: T[]) => any) {
    let batch: T[] = [];
    let timer: NodeJS.Timer | null = null;

    function flush() {
        if (batch.length > 0) {
            handler(batch);
            batch = [];
        }
        timer && clearTimeout(timer);
    }

    return (arg: T) => {
        batch.push(arg);

        if (batch.length >= nMax) {
            flush();
            return;
        }

        timer && clearTimeout(timer);
        timer = setTimeout(() => {
            flush();
        }, timeout);
    }
}

export default batch;
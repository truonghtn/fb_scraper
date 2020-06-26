export interface ICollector {
  collect(...data: any[]): Promise<void>;
}

export class ConsoleCollector implements ICollector {
  async collect(...data: any[]): Promise<void> {
    data.forEach(d => console.log(d));
  }
}
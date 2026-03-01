declare module '@/pyodide' {
  export class Pyodide {
    static instance: Pyodide | null
    pyodide: unknown
    outputCallback: ((text: string) => void) | null

    static getInstance(): Pyodide
    setOutput(callback: (text: string) => void): void
    init(): Promise<unknown>
    run(code: string): Promise<void>
    setGlobal(name: string, value: unknown): Promise<void>
    getGlobal(name: string): Promise<unknown>
    runWithIO(
      code: string,
      inputs: Record<string, number>
    ): Promise<number | number[] | Record<string, number> | null>
  }
}

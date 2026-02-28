import { loadPyodide } from "pyodide";

export class Pyodide {
  static instance = null;

  constructor() {
    this.pyodide = null;
    this.outputCallback = null;
  }

  // Gets the single shared instance
  static getInstance() {
    if (!Pyodide.instance) {
      Pyodide.instance = new Pyodide();
    }
    return Pyodide.instance;
  }

  // Tells Pyodide where to send the print statements
  setOutput(callback) {
    this.outputCallback = callback;
  }

  async init() {
    if (!this.pyodide) {
      this.pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/", // The version that works for you!
        stdout: (msg) => {
          if (this.outputCallback) this.outputCallback(msg);
        },
        stderr: (msg) => {
          if (this.outputCallback) this.outputCallback(msg);
        }
      });
    }
    return this.pyodide;
  }

  async run(code) {
    const py = await this.init();
    try {
      await py.runPythonAsync(code);
    } catch (error) {
      if (this.outputCallback) this.outputCallback(String(error));
    }
  }
}
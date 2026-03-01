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

  // Set a variable in the Python global namespace
  async setGlobal(name, value) {
    const py = await this.init();
    py.globals.set(name, value);
  }

  // Get a variable from the Python global namespace
  async getGlobal(name) {
    const py = await this.init();
    const value = py.globals.get(name);
    // Convert Python objects to JS if needed
    if (value && typeof value.toJs === 'function') {
      return value.toJs();
    }
    return value;
  }

  // Run code with inputs and capture the output variable
  async runWithIO(code, inputs) {
    const py = await this.init();

    // Set input variables in global namespace
    for (const [name, value] of Object.entries(inputs)) {
      py.globals.set(name, value);
    }

    // Clear any previous output by running Python code
    await py.runPythonAsync('output = None');

    // Run the user code
    try {
      await py.runPythonAsync(code);
    } catch (error) {
      if (this.outputCallback) this.outputCallback(String(error));
      throw error;
    }

    // Get the output variable
    try {
      const result = py.globals.get('output');
      if (result === undefined || result === null || String(result) === 'None') {
        return null;
      }
      // Convert Python objects to JS
      if (typeof result.toJs === 'function') {
        return result.toJs();
      }
      return result;
    } catch {
      return null;
    }
  }
}
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
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/",
        stdout: (msg) => {
          if (this.outputCallback) this.outputCallback(msg);
        },
        stderr: (msg) => {
          if (this.outputCallback) this.outputCallback(msg);
        }
      });
      // Load pandas and numpy
      await this.pyodide.loadPackage(['pandas', 'numpy']);
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

    // Setup helper functions for DataFrame conversion
    await py.runPythonAsync(`
import pandas as pd
import numpy as np

def __to_js_value__(val):
    """Convert Python value to JS-compatible format"""
    if isinstance(val, pd.DataFrame):
        return {
            '__type__': 'dataframe',
            'columns': val.columns.tolist(),
            'data': val.values.tolist(),
            'index': val.index.tolist()
        }
    elif isinstance(val, pd.Series):
        return {
            '__type__': 'series',
            'data': val.tolist(),
            'name': val.name
        }
    elif isinstance(val, np.ndarray):
        return val.tolist()
    elif hasattr(val, 'tolist'):
        return val.tolist()
    return val

def __from_js_value__(val):
    """Convert JS value back to Python"""
    if isinstance(val, dict):
        if val.get('__type__') == 'dataframe':
            return pd.DataFrame(val['data'], columns=val.get('columns'), index=val.get('index'))
        elif val.get('__type__') == 'series':
            return pd.Series(val['data'], name=val.get('name'))
    return val
`);

    // Set input variables in global namespace (converting from JS format)
    for (const [name, value] of Object.entries(inputs)) {
      py.globals.set('__temp__', py.toPy(value));
      await py.runPythonAsync(`${name} = __from_js_value__(__temp__)`);
    }

    // Clear any previous output
    await py.runPythonAsync('output = None');

    // Run the user code
    try {
      await py.runPythonAsync(code);
    } catch (error) {
      if (this.outputCallback) this.outputCallback(String(error));
      throw error;
    }

    // Get and convert the output variable
    try {
      await py.runPythonAsync('__output__ = __to_js_value__(output)');
      const result = py.globals.get('__output__');

      if (result === undefined || result === null || String(result) === 'None') {
        return null;
      }

      // Convert Python objects to JS with proper dict handling
      if (typeof result.toJs === 'function') {
        return result.toJs({ dict_converter: Object.fromEntries });
      }
      return result;
    } catch (e) {
      console.error('Error converting output:', e);
      return null;
    }
  }
}
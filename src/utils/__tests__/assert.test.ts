import { describe, it, expect } from "vitest";
import assert, { assertInterface, assertUnreachable, AssertionError } from "../assert";

describe("utils - assert", () => {
  it("should throw an error if the assertion is false", () => {
    let error: unknown;
    try {
      assert(false);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe("invalid assertion");
    expect(error.name).toBe("AssertionError");
  });

  it("should be able to take a message argument", () => {
    const myMessage = "foo bar\n\r";
    let error: unknown;
    try {
      assert(false, myMessage);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe(myMessage);
    expect(error.name).toBe("AssertionError");
  });

  it("should not throw an error if the assertion is true", () => {
    assert(true);
  });
});

describe("utils - assertInterface", () => {
  it("should throw if undefined or null is given", () => {
    let error: unknown;
    const nameOfMyObj = "toto titi";

    const objIface = {
      a: "number",
      b: "object",
      d: "function",
      e: "boolean",
    };
    try {
      assertInterface(undefined, objIface, nameOfMyObj);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe(`${nameOfMyObj} should be an object`);
    expect(error.name).toBe("AssertionError");

    error = null;

    try {
      assertInterface(null, objIface, nameOfMyObj);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe(`${nameOfMyObj} should be an object`);
    expect(error.name).toBe("AssertionError");
  });

  it("should throw if the concerned interface is not respected", () => {
    let error: unknown;
    const nameOfMyObj = "toto titi";
    const myObj = {
      a: 45,
      b: {
        c: "toto",
      },
      d: () => {
        /* noop */
      },
      e: true,
    };

    const objIface = {
      a: "number",
      b: "object",
      d: "function",
      e: "boolean",
      f: "function", // one more key
    };

    try {
      assertInterface(myObj, objIface, nameOfMyObj);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();

    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe(`${nameOfMyObj} should have property f as a function`);
    expect(error.name).toBe("AssertionError");
  });

  it("should name the interface 'object' if no name is specified", () => {
    let error: unknown;
    const myObj = {
      a: 45,
      b: {
        c: "toto",
      },
      d: () => {
        /* noop */
      },
      e: true,
    };

    const objIface = {
      a: "number",
      b: "object",
      d: "function",
      e: "boolean",
      f: "function", // one more key
    };

    try {
      assertInterface(myObj, objIface);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe("object should have property f as a function");
    expect(error.name).toBe("AssertionError");
  });

  it("should not throw if the concerned interface is respected", () => {
    const nameOfMyObj = "toto titi";
    const myObj = {
      a: 45,
      b: {
        c: "toto",
      },
      d: () => {
        /* noop */
      },
      e: true,
    };

    const objIface = {
      a: "number",
      b: "object",
      d: "function",
      e: "boolean",
    };

    assertInterface(myObj, objIface, nameOfMyObj);
  });

  it("should not consider inherited properties as part of the interface", () => {
    const nameOfMyObj = "toto titi";
    const myObj = {
      a: 45,
      b: {
        c: "toto",
      },
      d: () => {
        /* noop */
      },
      e: true,
    };

    (Object.prototype as { f?: string }).f = "number";

    const objIface = {
      a: "number",
      b: "object",
      d: "function",
      e: "boolean",
    };

    assertInterface(myObj, objIface, nameOfMyObj);
  });
});

describe("utils - AssertionError", () => {
  it("should format an Assertion when called", () => {
    const error = new AssertionError("foo");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AssertionError");
    expect(error.message).toBe("foo");
  });
});

describe("utils - assertUnreachable", () => {
  it("should throw an error if the function is called", () => {
    let error: unknown;
    try {
      assertUnreachable(4 as never);
    } catch (e: unknown) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);

    // Impossible check to shut-up TypeScript
    if (!(error instanceof Error)) {
      throw new Error("Impossible: already checked it was an Error instance");
    }
    expect(error.message).toBe("Unreachable path taken");
    expect(error.name).toBe("AssertionError");
  });
});

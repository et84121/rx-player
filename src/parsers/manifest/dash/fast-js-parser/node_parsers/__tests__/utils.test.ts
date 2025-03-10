import { describe, it, expect } from "vitest";
import type { ITNode } from "../../../../../../utils/xml-parser";
import { parseXml } from "../../../../../../utils/xml-parser";
import {
  MPDError,
  parseBoolean,
  parseByteRange,
  parseDateTime,
  parseDuration,
  parseIntOrBoolean,
  parseScheme,
} from "../utils";

describe("dash parser helpers", function () {
  describe("parseBoolean", () => {
    it('should return true if value is "true"', () => {
      expect(parseBoolean("true", "toto")).toEqual([true, null]);
    });

    it('should return false if value is "false"', () => {
      expect(parseBoolean("false", "titi")).toEqual([false, null]);
    });

    it("should return false for and an error any other value", () => {
      const parsed1 = parseBoolean("", "ab");
      const parsed2 = parseBoolean("foo", "ba");
      expect(parsed1[0]).toEqual(false);
      expect(parsed2[0]).toEqual(false);
      expect(parsed1[1]).toBeInstanceOf(MPDError);
      expect(parsed2[1]).toBeInstanceOf(MPDError);
      expect(parsed1[1]?.message).toEqual('`ab` property is not a boolean value but ""');
      expect(parsed2[1]?.message).toEqual(
        '`ba` property is not a boolean value but "foo"',
      );
    });
  });

  describe("parseIntOrBoolean", () => {
    it('should return true if value is "true"', () => {
      expect(parseIntOrBoolean("true", "toto")).toEqual([true, null]);
    });

    it('should return false if value is "false"', () => {
      expect(parseIntOrBoolean("false", "toto")).toEqual([false, null]);
    });

    it("should return a number for any number", () => {
      expect(parseIntOrBoolean("0", "foob1")).toEqual([0, null]);
      expect(parseIntOrBoolean("10", "foob2")).toEqual([10, null]);
      expect(parseIntOrBoolean("072", "foob3")).toEqual([72, null]);
      expect(parseIntOrBoolean("-698", "foob4")).toEqual([-698, null]);
    });

    it("should return null and an error for any other value", () => {
      const parsed1 = parseIntOrBoolean("", "ab");
      const parsed2 = parseIntOrBoolean("foo", "ba");
      expect(parsed1[0]).toEqual(null);
      expect(parsed2[0]).toEqual(null);
      expect(parsed1[1]).toBeInstanceOf(MPDError);
      expect(parsed2[1]).toBeInstanceOf(MPDError);
      expect(parsed1[1]?.message).toEqual(
        '`ab` property is not a boolean nor an integer but ""',
      );
      expect(parsed2[1]?.message).toEqual(
        '`ba` property is not a boolean nor an integer but "foo"',
      );
    });
  });

  describe("parseDateTime", () => {
    it("should correctly parse a given date into a timestamp", () => {
      expect(parseDateTime("1970-01-01T00:00:00Z", "a")).toEqual([0, null]);
      expect(parseDateTime("1998-11-22T10:40:50Z", "b")).toEqual([911731250, null]);
      expect(parseDateTime("1960-01-01T00:00:00Z", "c")).toEqual([-315619200, null]);
    });

    it("should return null and an error when the date is not recognized", () => {
      const parsed1 = parseDateTime("foo bar", "ab");
      const parsed2 = parseDateTime("2047-41-52T30:40:50Z", "ba");
      expect(parsed1[0]).toEqual(null);
      expect(parsed2[0]).toEqual(null);
      expect(parsed1[1]).toBeInstanceOf(MPDError);
      expect(parsed2[1]).toBeInstanceOf(MPDError);
      expect(parsed1[1]?.message).toEqual('`ab` is in an invalid date format: "foo bar"');
      expect(parsed2[1]?.message).toEqual(
        '`ba` is in an invalid date format: "2047-41-52T30:40:50Z"',
      );
    });
  });

  describe("parseDuration", () => {
    it("should correctly parse duration in ISO8061 format", function () {
      expect(parseDuration("P18Y9M4DT11H9M8S", "fooba")).toEqual([591361748, null]);
    });

    it("should correctly parse duration if missing the year", function () {
      expect(parseDuration("P9M4DT11H9M8S", "fooba")).toEqual([23713748, null]);
    });

    it("should correctly parse duration if missing the month", function () {
      expect(parseDuration("P18Y4DT11H9M8S", "fooba")).toEqual([568033748, null]);
    });

    it("should correctly parse duration if missing the day", function () {
      expect(parseDuration("P18Y9MT11H9M8S", "fooba")).toEqual([591016148, null]);
    });

    it("should correctly parse duration if missing the hours", function () {
      expect(parseDuration("P18Y9M4DT9M8S", "fooba")).toEqual([591322148, null]);
    });

    it("should correctly parse duration if missing the minutes", function () {
      expect(parseDuration("P18Y9M4DT11H8S", "fooba")).toEqual([591361208, null]);
    });

    it("should correctly parse duration if missing the seconds", function () {
      expect(parseDuration("P18Y9M4DT11H9M", "fooba")).toEqual([591361740, null]);
    });

    it("should return null and an error if duration not in ISO8061 format", function () {
      const parsed1 = parseDuration("1000", "fooba");
      expect(parsed1[0]).toEqual(null);
      expect(parsed1[1]).toBeInstanceOf(MPDError);
      expect(parsed1[1]?.message).toEqual(
        '`fooba` property has an unrecognized format "1000"',
      );
    });
    it("should return 0 and an error if given an empty string", function () {
      const parsed = parseDuration("", "fooba");
      expect(parsed[0]).toEqual(0);
      expect(parsed[1]).toBeInstanceOf(MPDError);
      expect(parsed[1]?.message).toEqual("`fooba` property is empty");
    });
  });

  describe("parseByteRange", () => {
    it("should correctly parse byte range", function () {
      const parsedByteRange = parseByteRange("1-1000", "tots");
      expect(parsedByteRange[0]).not.toEqual(null);
      expect(parsedByteRange[1]).toEqual(null);
      expect((parsedByteRange[0] as [number, number]).length).toEqual(2);
      expect((parsedByteRange[0] as [number, number])[0]).toEqual(1);
      expect((parsedByteRange[0] as [number, number])[1]).toEqual(1000);
    });
    it("should return null and an error if can't parse given byte range", function () {
      const parsed1 = parseByteRange("main", "prop");
      expect(parsed1[0]).toEqual(null);
      expect(parsed1[1]).toBeInstanceOf(MPDError);
      expect(parsed1[1]?.message).toEqual(
        '`prop` property has an unrecognized format "main"',
      );
    });
  });

  describe("parseScheme", () => {
    it("should correctly parse an element with no known attribute", () => {
      const element1 = parseXml("<Foo />")[0] as ITNode;
      expect(parseScheme(element1)).toEqual({});

      const element2 = parseXml('<Foo test="" />')[0] as ITNode;
      expect(parseScheme(element2)).toEqual({});
    });

    it("should correctly parse an element with a correct schemeIdUri attribute", () => {
      const element1 = parseXml('<Foo schemeIdUri="foobar " />')[0] as ITNode;
      expect(parseScheme(element1)).toEqual({ schemeIdUri: "foobar " });

      const element2 = parseXml('<Foo schemeIdUri="" />')[0] as ITNode;
      expect(parseScheme(element2)).toEqual({ schemeIdUri: "" });
    });

    it("should correctly parse an element with a correct value attribute", () => {
      const element1 = parseXml('<Foo value="foobar " />')[0] as ITNode;
      expect(parseScheme(element1)).toEqual({ value: "foobar " });

      const element2 = parseXml('<Foo value="" />')[0] as ITNode;
      expect(parseScheme(element2)).toEqual({ value: "" });
    });

    it("should correctly parse an element with both attributes", () => {
      const element = parseXml('<Foo schemeIdUri="baz" value="foobar " />')[0] as ITNode;
      expect(parseScheme(element)).toEqual({
        schemeIdUri: "baz",
        value: "foobar ",
      });
    });
  });
});

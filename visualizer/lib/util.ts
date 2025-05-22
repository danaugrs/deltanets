export const prettifyExpr = (expr: string) => {
  // Replase slashes with lambda
  let newString = expr.replaceAll("\\", "λ");

  // Convert letters to math style using letterToMathItalicSmall
  // newString = expr;

  return newString;
};

export const cleanExpr = (expr: string) => {
  // Convert letters back to regular style using mathItalicSmallToLetter
  // let newString = [...expr]
  //   .map(
  //     (char) =>
  //       mathItalicSmallToLetter[char as keyof typeof mathItalicSmallToLetter] ??
  //       char
  //   )
  //   .join("");

  // Adjust spacings
  return expr
    .replace(/\(\s+/g, "(") // remove spaces to the right of "("
    .replace(/\s+\)/g, ")") // remove spaces to the left of ")"
    .replace(/(?<!(\())\(/g, " (") // add spaces to the left of a sequence of "("
    .replace(/\)(?!(\)))/g, ") ") // add spaces to the right of a sequence of ")"
    .replace(/\.\s+/g, ".") // remove spaces to the right of "."
    .replace(/\s+\./g, ".") // remove spaces to the left of "."
    .replace(/\s\s+/g, " ") // combine adjacent spaces
    .trim();

  // return newString;
};

// Invert map of string => string
const invertMap = (map: {
  [key: string]: string;
}): { [key: string]: string } => {
  const result: { [key: string]: string } = {};
  for (const key in map) {
    const value = map[key];
    result[value] = key;
  }
  return result;
};

export const numberToSubscript = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};
export const subscriptToNumber = invertMap(numberToSubscript);

const letterToMathItalicSmall = {
  a: "𝑎",
  A: "𝐴",
  b: "𝑏",
  B: "𝐵",
  c: "𝑐",
  C: "𝐶",
  d: "𝑑",
  D: "𝐷",
  e: "𝑒",
  E: "𝐸",
  f: "𝑓",
  F: "𝐹",
  g: "𝑔",
  G: "𝐺",
  h: "ℎ",
  H: "𝐻",
  i: "𝑖",
  I: "𝐼",
  j: "𝑗",
  J: "𝐽",
  k: "𝑘",
  K: "𝐾",
  l: "𝑙",
  L: "𝐿",
  m: "𝑚",
  M: "𝑀",
  n: "𝑛",
  N: "𝑁",
  o: "𝑜",
  O: "𝑂",
  p: "𝑝",
  P: "𝑃",
  q: "𝑞",
  Q: "𝑄",
  r: "𝑟",
  R: "𝑅",
  s: "𝑠",
  S: "𝑆",
  t: "𝑡",
  T: "𝑇",
  u: "𝑢",
  U: "𝑈",
  v: "𝑣",
  V: "𝑉",
  w: "𝑤",
  W: "𝑊",
  x: "𝑥",
  X: "𝑋",
  y: "𝑦",
  Y: "𝑌",
  z: "𝑧",
  Z: "𝑍",
};
export const mathItalicSmallToLetter = invertMap(letterToMathItalicSmall);

export function nameToFancyName(str: string) {
  return [...str]
    .map((char) => {
      return (
        numberToSubscript[char as keyof typeof numberToSubscript] ??
        letterToMathItalicSmall[char as keyof typeof letterToMathItalicSmall] ??
        char
      );
    })
    .join("");
}

export function fancyNameToName(str: string) {
  return [...str]
    .map((char) => {
      return (
        subscriptToNumber[char as keyof typeof subscriptToNumber] ??
        mathItalicSmallToLetter[char as keyof typeof mathItalicSmallToLetter] ??
        char
      );
    })
    .join("");
}

// Helper to get the minimum and maximum of two numbers
export function minMax(a: number, b: number) {
  return a > b ? [b, a] : [a, b];
}

// Helper to remove an element from an array
export function removeFromArrayIf<E>(
  array: E[],
  callback: (e: E, i: number) => boolean
) {
  let i = array.length;
  while (i--) {
    if (callback(array[i], i)) {
      array.splice(i, 1);
    }
  }
}

// Helper to remove elements from an array
export function removeFromArray<E>(array: E[], elements: E[]) {
  for (const element of elements) {
    const index = array.indexOf(element);
    if (index !== -1) {
      array.splice(index, 1);
    }
  }
}

export type Matrix = number[][];

// Returns the inverse of an invertible matrix `M`.
// Uses Gaussian Elimination to calculate the inverse:
//   1) Augments the matrix M (left) by the identity (on the right)
//   2) Applies elementary row operations until the the matrix on the left becomes the identity matrix
//   3) Returns the matrix on the right, which is now the inverse of M
// There are three elementary row operations:
//   a) Swap two rows
//   b) Multiply a row by a scalar
//   c) Add two rows
// In the implementation (b) and (c) are combined
export function invertMatrix(M: Matrix) {
  // Ensure that the matrix is square
  const dim = M.length;
  if (dim !== M[0].length) {
    throw new Error("Matrix is not square");
  }
  // Create the identity matrix (I), and a copy (C) of the original
  const I: Matrix = [];
  const C: Matrix = [];
  for (let i = 0; i < M.length; i += 1) {
    // Create the rows
    I[i] = [];
    C[i] = [];
    for (let j = 0; j < dim; j += 1) {
      // If we're on the diagonal, set the cell to 1 (for the identity)
      I[i][j] = i == j ? 1 : 0;
      // Also, make the copy of the original
      C[i][j] = M[i][j];
    }
  }
  // Perform elementary row operations
  for (let i = 0; i < dim; i += 1) {
    // Get the element e on the diagonal
    let e = C[i][i];
    // If we have a 0 on the diagonal we'll need to swap this row with a lower row
    if (e == 0) {
      // Look through every row below the i'th row
      for (let ii = i + 1; ii < dim; ii += 1) {
        // If the ii'th row has a non-0 in the i'th col
        if (C[ii][i] != 0) {
          // It would make the diagonal have a non-0 so swap it
          for (let j = 0; j < dim; j++) {
            e = C[i][j]; //temp store i'th row
            C[i][j] = C[ii][j]; //replace i'th row by ii'th
            C[ii][j] = e; //repace ii'th by temp
            e = I[i][j]; //temp store i'th row
            I[i][j] = I[ii][j]; //replace i'th row by ii'th
            I[ii][j] = e; //repace ii'th by temp
          }
          // Don't bother checking other rows since we've swapped
          break;
        }
      }
      // Get the new diagonal
      e = C[i][i];
      // If it's still 0 then the matrix is not invertible
      if (e == 0) {
        throw new Error("Matrix is not invertible");
      }
    }

    // Scale this row down by e (so we have a 1 on the diagonal)
    for (let j = 0; j < dim; j++) {
      C[i][j] = C[i][j] / e; // Apply to original matrix
      I[i][j] = I[i][j] / e; // Apply to identity
    }

    // Subtract this row (scaled appropriately for each row) from ALL of
    // the other rows so that there will be 0's in this column in the
    // rows above and below this one
    for (let ii = 0; ii < dim; ii++) {
      // Only apply to other rows (we want a 1 on the diagonal)
      if (ii == i) {
        continue;
      }
      // We want to change this element to 0
      e = C[ii][i];
      // Subtract the row above or below scaled by e from the
      // current row but start at the i'th column (assumes all the
      // cells left of the diagonal are 0, which they should be)
      for (let j = 0; j < dim; j++) {
        C[ii][j] -= e * C[i][j]; // Apply to original matrix
        I[ii][j] -= e * I[i][j]; // Apply to identity
      }
    }
  }

  // We've done all operations, C should be the identity matrix and I should be the inverse
  return I;
}

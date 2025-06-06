const examples = [
  {
    name: "Starter",
    code: `# Reduce the net by clicking on highlighted node pairs (green = optimal), using the arrow keys on your keyboard, or clicking the buttons in the toolbar.

# Use backslash ("\\") to insert a "λ".
# Give a name to a lambda term with "=".
# For example:

I = λx.x # The identity function
T = λx.λy.x # Boolean True
F = λx.λy.y # Boolean False
And = λp.λq.p q p # Logical AND
Or = λp.λq.p p q # Logical OR
Not = λp.p F T # Logical NOT

# The last expression (below) is then represented as a graph/net on the right-hand-side of the screen.
And T F`,
  },
  {
    name: "Lamping A",
    code: `# Lamping A
(λx.(λy.((λf.((λh.(h (λp.(h (λq.p))))) (λl.(((f (λn.(l n))) x) y)))) (λg.(λu.(λv.((g u) (g v))))))))`,
  },
  {
    name: "Lamping B",
    code: `# Lamping B
(λx.(λy.((λf.((λh.(h (λp.(h (λq.q))))) (λl.(((f (λn.(l n))) x) y)))) (λg.(λu.(λv.((g u) (g v))))))))`,
  },
  {
    name: "Ω (Non-Normalizing)",
    code: `# Ω (Non-Normalizing)
(λa.a a) (λb.b b)`,
  },
  {
    name: "Y (Non-Normalizing)",
    code: `# Y (Non-Normalizing)
λf.(λx.f (x x)) (λx.f (x x))`,
  },
  {
    name: "Two Squared Twice",
    code: `# Two Squared Twice
(λa.a (a a)) λf.λx.f (f x)`,
  },
  {
    name: "Erasure vs Sharing",
    code: `# Erasure vs Sharing
(λk.u) (λf.(λx.f (x x)) (λx.f (x x)))`,
  },
  {
    name: "Replicator Decay",
    code: `# Replicator Decay
λp.p ((λk.u) (λf.p p))
`
  },
  {
    name: "Graph Coloring",
    code: `# Graph Coloring

T = λx.λy.x # Boolean True
F = λx.λy.y # Boolean False
Or = λp.λq.p p q # Logical OR
Not = λp.p F T # Logical NOT

# Colors
C1 = λc1.λc2.c1
C2 = λc1.λc2.c2

# ColorEq returns T if two colors are equal, and F otherwise
ColorEq = λa.λb.a (b T F) (b F T)

# Colorable returns T if a function f returns T for any of the two colors, and F otherwise
Colorable = λf.Or (f C1) (f C2)

# A 2-colorable graph with 2 nodes
# 1---2
GraphColorable = Colorable λn1.Colorable λn2.Not (ColorEq n1 n2)

# A non-2-colorable graph with 3 nodes
# 1---2
#  \\ /
#   3
GraphNotColorable = Colorable λn1.Colorable λn2.Colorable λn3.Not (Or (ColorEq n1 n2) (Or (ColorEq n2 n3) (ColorEq n1 n3)))

GraphColorable # Results in T
# GraphNotColorable # Results in F
`,
  },
];

export default examples;

/* Browsable Unicode glyphs and their equivalent TeX, shared by both exporters. */
const greek = [
    ["alpha","α","Α","alpha","mathrm{A}"], ["beta","β","Β","beta","mathrm{B}"],
    ["gamma","γ","Γ","gamma","Gamma"], ["delta-lower","δ","Δ","delta","Delta"],
    ["epsilon","ε","Ε","varepsilon","mathrm{E}"], ["zeta","ζ","Ζ","zeta","mathrm{Z}"],
    ["eta","η","Η","eta","mathrm{H}"], ["theta","θ","Θ","theta","Theta"],
    ["iota","ι","Ι","iota","mathrm{I}"], ["kappa","κ","Κ","kappa","mathrm{K}"],
    ["lambda","λ","Λ","lambda","Lambda"], ["mu","μ","Μ","mu","mathrm{M}"],
    ["nu","ν","Ν","nu","mathrm{N}"], ["xi","ξ","Ξ","xi","Xi"],
    ["omicron","ο","Ο","mathrm{o}","mathrm{O}"], ["pi","π","Π","pi","Pi"],
    ["rho","ρ","Ρ","rho","mathrm{P}"], ["sigma","σ","Σ","sigma","Sigma"],
    ["tau","τ","Τ","tau","mathrm{T}"], ["upsilon","υ","Υ","upsilon","Upsilon"],
    ["phi","φ","Φ","phi","Phi"], ["chi","χ","Χ","chi","mathrm{X}"],
    ["psi","ψ","Ψ","psi","Psi"], ["omega","ω","Ω","omega","Omega"]
];
const title = id => id.replace("-lower", "").replace(/^./, c => c.toUpperCase());
const symbols = rows => rows.map(([id,label,text,tex]) => ({id,label,text,tex:`$${tex}$`}));
const group = (id,label,rows) => ({id,label,symbols:symbols(rows)});
export const MATH_SYMBOL_GROUPS = [
    {id:"greek-math",label:"Greek — lowercase",symbols:greek.map(([id,text,,tex])=>({id,label:`${title(id)} (lowercase)`,text,tex:`$\\${tex}$`}))},
    {id:"greek-uppercase",label:"Greek — uppercase",symbols:greek.map(([id,,text,,tex])=>({id:`greek-upper-${id.replace('-lower','')}`,label:`${title(id)} (uppercase)`,text,tex:`$\\${tex}$`}))},
    group("greek-variants","Greek — variants",[
        ["epsilon-variant","Epsilon variant","ϵ","\\epsilon"], ["theta-variant","Theta variant","ϑ","\\vartheta"],
        ["kappa-variant","Kappa variant","ϰ","\\varkappa"], ["pi-variant","Pi variant","ϖ","\\varpi"],
        ["rho-variant","Rho variant","ϱ","\\varrho"], ["sigma-final","Final sigma","ς","\\varsigma"],
        ["phi-variant","Phi variant","ϕ","\\varphi"], ["delta-sym","Delta symbol","Δ","\\Delta"]
    ]),
    group("arithmetic","Arithmetic & operators",[
        ["plus","Plus","+","+"], ["minus","Minus","−","-"], ["minus-plus","Minus / Plus","∓","\\mp"],
        ["multiply","Multiply","×","\\times"], ["divide","Divide","÷","\\div"], ["dot-product","Dot product","⋅","\\cdot"],
        ["asterisk","Asterisk operator","∗","\\ast"], ["star","Star operator","⋆","\\star"],
        ["composition","Composition","∘","\\circ"], ["bullet","Bullet operator","∙","\\bullet"],
        ["circled-plus","Circled plus","⊕","\\oplus"], ["circled-minus","Circled minus","⊖","\\ominus"],
        ["circled-times","Circled times","⊗","\\otimes"], ["circled-dot","Circled dot","⊙","\\odot"],
        ["square-root","Square root","√","\\surd"], ["cube-root","Cube root","∛","\\sqrt[3]{}"],
        ["fourth-root","Fourth root","∜","\\sqrt[4]{}"], ["factorial","Factorial","!","!"], ["percent","Percent","%","\\%"]
    ]),
    group("relations","Relations & comparisons",[
        ["equals","Equals","=","="], ["not-equal","Not equal","≠","\\ne"], ["less-than","Less than","<","<"],
        ["greater-than","Greater than",">",">"], ["less-equal","Less than or equal","≤","\\leq"],
        ["greater-equal","Greater than or equal","≥","\\geq"], ["approximately","Approximately equal","≈","\\approx"],
        ["similar","Similar","∼","\\sim"], ["asymptotic","Asymptotically equal","≃","\\simeq"],
        ["congruent","Congruent","≅","\\cong"], ["equivalent","Equivalent","≡","\\equiv"],
        ["proportional","Proportional to","∝","\\propto"], ["much-less","Much less than","≪","\\ll"],
        ["much-greater","Much greater than","≫","\\gg"], ["less-similar","Less than or similar","≲","\\lesssim"],
        ["greater-similar","Greater than or similar","≳","\\gtrsim"], ["precedes","Precedes","≺","\\prec"],
        ["succeeds","Succeeds","≻","\\succ"], ["precedes-equal","Precedes or equal","≼","\\preceq"],
        ["succeeds-equal","Succeeds or equal","≽","\\succeq"]
    ]),
    group("calculus","Calculus & large operators",[
        ["sum","Summation","Σ","\\Sigma"], ["summation-operator","Summation operator","∑","\\sum"],
        ["product","Product operator","∏","\\prod"], ["coproduct","Coproduct","∐","\\coprod"],
        ["integral","Integral","∫","\\int"], ["double-integral","Double integral","∬","\\iint"],
        ["triple-integral","Triple integral","∭","\\iiint"], ["contour-integral","Contour integral","∮","\\oint"],
        ["partial","Partial derivative","∂","\\partial"], ["nabla","Nabla / gradient","∇","\\nabla"],
        ["infinity","Infinity","∞","\\infty"], ["prime","Prime","′","\\prime"], ["double-prime","Double prime","″","\\prime\\prime"],
        ["horizontal-ellipsis","Horizontal ellipsis","…","\\ldots"], ["centered-ellipsis","Centred ellipsis","⋯","\\cdots"],
        ["vertical-ellipsis","Vertical ellipsis","⋮","\\vdots"], ["diagonal-ellipsis","Diagonal ellipsis","⋱","\\ddots"]
    ]),
    group("sets-logic","Sets & logic",[
        ["element-of","Element of","∈","\\in"], ["not-element-of","Not an element of","∉","\\notin"],
        ["contains-element","Contains element","∋","\\ni"], ["empty-set","Empty set","∅","\\emptyset"],
        ["union","Union","∪","\\cup"], ["intersection","Intersection","∩","\\cap"],
        ["subset","Subset","⊂","\\subset"], ["superset","Superset","⊃","\\supset"],
        ["subset-equal","Subset or equal","⊆","\\subseteq"], ["superset-equal","Superset or equal","⊇","\\supseteq"],
        ["not-subset","Not a subset","⊄","\\not\\subset"], ["set-difference","Set difference","∖","\\setminus"],
        ["disjoint-union","Disjoint union","⊎","\\uplus"], ["for-all","For all","∀","\\forall"],
        ["exists","There exists","∃","\\exists"], ["not-exists","Does not exist","∄","\\nexists"],
        ["logical-not","Logical NOT","¬","\\neg"], ["logical-and","Logical AND","∧","\\land"],
        ["logical-or","Logical OR","∨","\\lor"], ["therefore","Therefore","∴","\\therefore"],
        ["because","Because","∵","\\because"], ["proves","Proves","⊢","\\vdash"], ["models","Models","⊨","\\models"],
        ["naturals","Natural numbers","ℕ","\\mathbb{N}"], ["integers","Integers","ℤ","\\mathbb{Z}"],
        ["rationals","Rational numbers","ℚ","\\mathbb{Q}"], ["reals","Real numbers","ℝ","\\mathbb{R}"],
        ["complex","Complex numbers","ℂ","\\mathbb{C}"]
    ]),
    group("arrows","Arrows & mappings",[
        ["arrow-left","Left arrow","←","\\leftarrow"], ["arrow-right","Right arrow","→","\\rightarrow"],
        ["arrow-up","Up arrow","↑","\\uparrow"], ["arrow-down","Down arrow","↓","\\downarrow"],
        ["arrow-left-right","Left-right arrow","↔","\\leftrightarrow"], ["arrow-up-down","Up-down arrow","↕","\\updownarrow"],
        ["implies","Implies","⇒","\\Rightarrow"], ["implied-by","Implied by","⇐","\\Leftarrow"],
        ["if-and-only-if","If and only if","⇔","\\Leftrightarrow"], ["maps-to","Maps to","↦","\\mapsto"],
        ["long-right-arrow","Long right arrow","⟶","\\longrightarrow"], ["long-left-arrow","Long left arrow","⟵","\\longleftarrow"],
        ["north-east-arrow","North-east arrow","↗","\\nearrow"], ["south-east-arrow","South-east arrow","↘","\\searrow"],
        ["south-west-arrow","South-west arrow","↙","\\swarrow"], ["north-west-arrow","North-west arrow","↖","\\nwarrow"],
        ["equilibrium","Equilibrium arrows","⇌","\\rightleftharpoons"]
    ]),
    group("geometry-notation","Geometry & notation",[
        ["angle","Angle","∠","\\angle"], ["measured-angle","Measured angle","∡","\\measuredangle"],
        ["triangle-symbol","Triangle","△","\\triangle"], ["triangle-down","Down triangle","▽","\\triangledown"],
        ["diamond","Diamond","◇","\\diamond"], ["circle-symbol","Circle","○","\\bigcirc"],
        ["ceiling-left","Left ceiling","⌈","\\lceil"], ["ceiling-right","Right ceiling","⌉","\\rceil"],
        ["floor-left","Left floor","⌊","\\lfloor"], ["floor-right","Right floor","⌋","\\rfloor"],
        ["bracket-left","Left angle bracket","⟨","\\langle"], ["bracket-right","Right angle bracket","⟩","\\rangle"]
    ])
];
export const SYMBOL_TEX = {
    ...Object.fromEntries(MATH_SYMBOL_GROUPS.flatMap(group => group.symbols).filter(symbol => symbol.text.codePointAt(0) > 127).map(symbol => [symbol.text,symbol.tex])),
    "⌖":"$\\oplus$", "⏥":"$\\lozenge$", "∥":"$\\parallel$", "⊥":"$\\perp$", "◎":"$\\circledcirc$",
    "⏓":"$\\surd$", "▷":"$\\triangleright$", "⊻":"$\\veebar$", "℄":"\\textsf{CL}", "Ⓐ":"\\ooalign{\\hfil A\\hfil\\cr\\hfil$\\bigcirc$\\hfil\\cr}",
    "▭":"$\\square$", "□":"$\\square$", "⌴":"$\\sqcup$", "⌵":"$\\vee$"
};

# Type Narrowing Procedure for LLMs

## Purpose
- Provide a concise, deterministic workflow an LLM should follow to narrow TypeScript types when `able_annotation` reveals a union or ambiguous type
- Minimize unsafe assertions and prefer language-supported narrowing techniques

## Scope
- Applies when a variable's type is a union, unknown to the LLM, or when TypeScript type errors indicate ambiguous types
- Not for pure syntax, missing-module, or lint-only issues

## Procedure

1. Obtain type information with `able_annotation`
   - Call the tool with a small code fragment (error line + ~2 lines of context)
   - Example payload:
     ```json
     {
       "filePath": "/absolute/path/to/file.ts",
       "code": "const r = maybeGet()\n// two lines of surrounding context"
     }
     ```
   - Inspect annotated code comments like `// <var> satisfies <Type>` and read the accompanying JSON for canonical definitions

2. Determine if the type is a union
   - If not a union, follow normal type-checking and add null/undefined checks if needed
   - If union, proceed to narrowing selection

3. Preferred narrowing methods (priority order)
   1. Discriminated union (preferred)
      - Use a single discriminant property present on every branch (e.g., `kind`, `type`)
   2. `instanceof` (for class instances)
   3. `typeof` on the variable itself (for primitive unions like `string | number`)
   4. User-defined type guards with `is` predicates
   5. Constrained generics or signature changes (at API boundaries)
   6. Null/undefined checks or optional chaining for optional values

4. What to avoid
   - Do not use property-shape checks for narrowing (e.g., checking presence of a property, `'value' in x`, or inspecting arbitrary members)
   - Avoid type assertions (`as T`), `as unknown`, or defining function parameters as `unknown`
   - Prefer `undefined` for optional values instead of `null`
   - Avoid using `any` or unsafe casts to silence errors

5. Practical narrowing flow
   1. Call `able_annotation` for the minimal fragment showing the issue  
   2. If a discriminant exists, use it (`switch` / `if`) to narrow branches  
   3. Else, prefer `instanceof` or user-defined type guard functions with `x is Foo` signature  
   4. Add null/undefined checks or optional chaining as appropriate  
   5. Run TypeScript compile and tests; if type errors remain, call `able_annotation` again with the new failing fragment

6. Checklist for changes
   - `able_annotation` used and inspected
   - Discriminant considered and used if available
   - Avoided property-shape checks and unsafe assertions
   - Added user-defined guard or `instanceof`/`typeof` where appropriate
   - Optional values handled with `undefined` and optional chaining
   - Tests added or updated to cover narrowed code paths

7. Examples

    Discriminated union
    ```typescript
    // Example showing discriminated union narrowing
    type Success = { kind: 'success'; value: number }
    type Failure = { kind: 'failure'; reason: string }
    type Result = Success | Failure

    function handleResult(r: Result) {
      // r is narrowed by checking the discriminant
      if (r.kind === 'success') {
        // r is Success here
        console.log(r.value)
      } else {
        // r is Failure here
        console.error(r.reason)
      }
    }
    ```

    `instanceof` example
    ```typescript
    // Example demonstrating instanceof narrowing
    class A {
      aProp = 'a'
    }
    class B {
      bProp = 1
    }
    type Item = A | B

    function process(item: Item) {
      if (item instanceof A) {
        // item is A here
        console.log(item.aProp)
      } else {
        // item is B here
        console.log(item.bProp)
      }
    }
    ```

    `typeof` example for primitives
    ```typescript
    // Use typeof on the variable itself for primitive unions
    function stringify(x: string | number) {
      if (typeof x === 'string') {
        // x is string here
        return x.toUpperCase()
      }
      // x is number here
      return x.toFixed(2)
    }
    ```

    User-defined type guard
    ```typescript
    // User-defined type guard with `is` predicate
    type Foo = { fooProp: string }
    type Bar = { barProp: number }
    type Item = Foo | Bar

    function isFoo(x: Item): x is Foo {
      // Implement a reliable check that does not rely on arbitrary property-shape heuristics
      // For example, use a discriminant if available, or a safe runtime check
      return typeof (x as Foo).fooProp === 'string'
    }

    function processItem(item: Item) {
      if (isFoo(item)) {
        // item is Foo here
        console.log(item.fooProp)
      } else {
        // item is Bar here
        console.log(item.barProp)
      }
    }
    ```

8. When to call `able_annotation` again
   - After making a targeted change if TypeScript still reports a type-related error
   - Provide a minimal snippet (error line + context) each time

9. Summary (short)
- Always prefer safe narrowing techniques: discriminated unions, `instanceof`, `typeof` on variable primitives, user-defined guards, constrained generics
- Use `able_annotation` to reveal canonical types and definition locations before adding guards
- Avoid unsafe casts and property-shape checks, and prefer `undefined` for optional values

End of procedure

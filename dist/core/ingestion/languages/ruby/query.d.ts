/**
 * Tree-sitter query for Ruby scope captures (U1 scope-resolution migration).
 *
 * Captures the structural skeleton the generic scope-resolution pipeline
 * consumes: scopes (program/class/module/method/block), declarations
 * (class, module, method, singleton_method, variable), imports
 * (require/require_relative/load), type bindings (constructor-inferred
 * locals via `.new`), and references (free calls, member calls).
 *
 * Ruby specifics that shape this query:
 *
 *   - Ruby modules are class-like scopes (they hold methods and can be
 *     mixed in via include/extend/prepend).
 *
 *   - `singleton_method` (`def self.foo`) is a class-level method
 *     declaration, captured as @scope.function + @declaration.function.
 *
 *   - Ruby has no static type annotations. Constructor inference via
 *     `x = User.new` is handled here; YARD `@param`/`@return` comments
 *     are handled programmatically in captures.ts.
 *
 *   - In Ruby, field access IS a method call (attr_reader generates
 *     methods). Member calls cover both method calls and field reads.
 *
 *   - `require`, `require_relative`, and `load` are plain method calls
 *     in the grammar — matched by name via `#match?`.
 *
 *   - `do_block` and `block` (`{ }`) are both block scopes that can
 *     introduce closures.
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't pay
 * tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getRubyParser(): Parser;
export declare function getRubyScopeQuery(): Parser.Query;

/**
 * Undo/redo command stack for Best Rich Editor.
 */
export function createCommands() {
  /** @type {Array<{execute: Function, undo: Function}>} */
  const stack = [];
  let pointer = -1;

  /**
   * Execute a command and push it onto the stack.
   * Discards any redo history beyond the current pointer.
   */
  function execute(command) {
    // Discard redo history
    stack.splice(pointer + 1);
    command.execute();
    stack.push(command);
    pointer = stack.length - 1;
  }

  /**
   * Undo the last command.
   */
  function undo() {
    if (!canUndo()) return;
    stack[pointer].undo();
    pointer--;
  }

  /**
   * Redo the next command.
   */
  function redo() {
    if (!canRedo()) return;
    pointer++;
    stack[pointer].execute();
  }

  function canUndo() {
    return pointer >= 0;
  }

  function canRedo() {
    return pointer < stack.length - 1;
  }

  return { execute, undo, redo, canUndo, canRedo };
}

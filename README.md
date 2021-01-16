# A Node-Red node for the MCP23017 chip
	About Node-Red: https://nodered.org/
	Link for the chip itself: https://www.microchip.com/wwwproducts/en/MCP23017
	PDF: https://ww1.microchip.com/downloads/en/DeviceDoc/20001952C.pdf
	Node-RED node link: https://flows.nodered.org/node/node-red-contrib-mcp23017chip

# Code Language: 
	Node.js https://nodejs.org
	JavaScript https://en.wikipedia.org/wiki/JavaScript
	HTML https://en.wikipedia.org/wiki/HTML

# About
	It uses the config node "mcp23017chip" for all reading and writing on i2c bus
	More about I2C: https://en.wikipedia.org/wiki/I%C2%B2C

	- Each pin (16 in total) can be individually selected to be an input or output
	- You need to place as many Nodes to your flows as many pins you use.
	- 4 states of a node: On=green   Off=grey   Uninitialised=yellow   Error=red

	Requires 'i2c-bus' module: https://github.com/fivdi/i2c-bus
	( _It gets automatically installed, except if you want to use it directly from function nodes._ )

# Inputs

**WARNING:** input part of this component is a bit messy, had no time to rework the original code.
 - it reads non-stop, using high CPU
 - it might starts multiple timers that interfere with each other? (Needs investigation.)
 - to minimize state-refresh problem there is secondary "de-bounce" timer
 - can not handle interrupts

# Config

- The Chip can be configured with "I2C bus number" + "Chip Address" globally.

- The interval is used to determine how frequently all inputs are polled. (Reads all 8+8 ports from bank A+B.)
 (! Should be minimum 20ms, because a read process of 16 pins takes 12-14ms on a Raspberry Pi 4.)

- The bit number is 0 to 15 reflecting the pin

- Pull Up engages the low power pull up resistor. More: https://en.wikipedia.org/wiki/Pull-up_resistor 
 (Inputs only.)

- Debounce is a timer where the state must remain at the new level for the time for a change to get to the output
 (Inputs only.)
 ( _It will filter out too short changes, like sparkles._ )

- Invert engages the "invert bit" on the chip at Input, and software-override at the Output (0>>1 and 1>>0)
 ( _For example some relay boards are "closing = pulling" if they get GND instead of 5V on their pins, 
 so they need to be negated with resistors. In those cases the chip must get 0x00 to "turn on"._ )



# To Do

1. Don't even allow already selected bits to be selected again (not just erroring about)
2. When a node is deleted - remove from ids (array in chip)
3. Block RW operations happening at the same time... (rework everything to Async / await and atomic flags)
4. Analize how interrupts are dealt with in C code and write it in JavaScript. 
 Example in C language here: https://www.arduinolibraries.info/libraries/mcp23017



# Change Log 2021-01-11 (Y-M-D) by László Szakmári (www.pizzaprogram.hu)

- **!!! IMPORTANT CHANGE:**
 -- [ x ] Inverse is now affecting Output too ! 
 (Some relay boards are functioning "the opposite way", turning ON if pin is Low.)

- Changed Bus open/close behaviour. Separate open before/after each read/write operation block. 
  (This way no more non-stop opened bus > no more NodeRed crash if unexpected disconnect.)

- Fixed other NR crashes: Added Error handling (try - catch) for each i2c bus operation.
  Each operation has it's own value to report proper error text. _(Like: "Bus opening failed", ... etc)_
  (But execution time increased from 8ms to 12ms on Raspberri 4)

- Fixed 16pin array initialization (16x null)

- Added multiple/same pin initialization error handling. (Highlander: "There Can Be Only One" :-D )

- Added lots of comments and constants to mcp23017chip.js file (like IOCON, IODIR_A, etc...)

- Changed icon to a chip-like one. (font-awesome/fa-ticket)

- Faster initialisation: if set to output >> skips pullup & invert writes. 

- Prevents the input-timer to run if the previous function is still running.

- +2 states of a node and color change of Off: On=green   Off=grey   Uninitialised=yellow   Error=red

- Does not starting input-timer, if there are no input nodes available. 

- Auto-increasing read-interval if < 15ms or if reading took too long.

- If error occured during read-timer >> changing interval to 5 sec >> if normal again >> changing back

- Dokument + Code changes:
-- Pretty print of JS code (inline)
-- All local variables start now with _underline
-- Many comments + constants + references added to code
-- Fixed help in mcp23017chip.html file
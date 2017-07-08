Node-Red node for the MCP23017

Each pin (16 in total) can be selected to be an input or output
Inputs
The interval is used to determine how frequently the chip is polled 
The bit number is 0 to 15 reflecting the pin
Pull Up engages the low power pull up
Invert engages the inver on the chip
Debounce is a timer where the state must remain at the new level for the debounce time for a change to get to the output


Uses the config node mcp23017chip for all reading and writing on i2c


Requires i2c-bus

To Do
1) Don't allow already selected bits to be selected again
2) When a node is deleted - remove from ids (array in chip)

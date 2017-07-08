// CHIP SECTION - For inputs this reads the chip and fires the input module 
module.exports = function(RED) {
	var i2cBus = require("i2c-bus");
	function mcp23017chipNode(n) {
		RED.nodes.createNode(this,n);
		this.addr = parseInt(n.addr, 16);
		this.interval = n.interval;
		this.isInputs = 0x0000;
		this.pullUps = 0x0000;
		this.inverts = 0x0000;
		this.ids = new Array(16);
		this.lastRead = 0x0000;
		this.lastWrite = 0x0000;
		
		this.i2c1 = i2cBus.openSync(1);
		this.i2c1.writeByteSync(this.addr, 0x0A, 0x00); //set mode iocan bank

		this.setBit = function(bitNum, isInput, pullUp, invert, id){
			
			for (var i=0; i < 16; i++){//NEED TO REMOVE ANY OTHER REFERENCES TO THIS ID
				if (this.ids[i] == id) {this.ids[i] = null;}
			}
			this.ids[bitNum] = id;
			if (isInput) {this.isInputs = this.isInputs | (1<<bitNum)} else {this.isInputs = this.isInputs & ~(1<<bitNum)};
			if (pullUp) {this.pullUps = this.pullUps | (1<<bitNum)} else {this.pullUps = this.pullUps & ~(1<<bitNum)};
			if (invert) {this.inverts = this.inverts | (1<<bitNum)} else {this.inverts = this.inverts & ~(1<<bitNum)};
			this.i2c1.writeByteSync(this.addr, 0x00, this.isInputs & 0xFF);//update in out mode A
			this.i2c1.writeByteSync(this.addr, 0x01, (this.isInputs >> 8) & 0xFF);//update in out mode B
			this.i2c1.writeByteSync(this.addr, 0x0C, this.pullUps & 0xFF);	//update pull up A
			this.i2c1.writeByteSync(this.addr, 0x0D, (this.pullUps >> 8) & 0xFF);	//update pull up B
			this.i2c1.writeByteSync(this.addr, 0x02, this.inverts & 0xFF);	//update pull up A
			this.i2c1.writeByteSync(this.addr, 0x03, (this.inverts >> 8) & 0xFF);	//update pull up B
		}
		
		this.setOutput = function(bitNum, newState){
			if (newState){
				this.lastWrite = this.lastWrite | 1 << bitNum;
			} else {
				this.lastWrite = this.lastWrite & ~ (1 << bitNum);
			}
			if (bitNum < 8) {
				this.i2c1.writeByteSync(this.addr, 0x14, this.lastWrite & 0xFF);	//Set output A
			} else {
				this.i2c1.writeByteSync(this.addr, 0x15, (this.lastWrite >> 8) & 0xFF);	//Set output B
			}
		}
		
		var myVar = setInterval(myTimer, this.interval, this );
		
		function myTimer(theChip) {
			var ipA = theChip.i2c1.readByteSync(theChip.addr, 0x12);
			var ipB = theChip.i2c1.readByteSync(theChip.addr, 0x13);
			var ipAll = ipA + (ipB << 8);
			if (ipAll != theChip.lastRead){
				var diffWord = ipAll ^ theChip.lastRead;
				for (var i=0; i < 16; i++){
					if (diffWord & (1 << i)){
						var newState =  (((ipAll & (1 << i)) == 0) ? false : true) 
						var aBit = RED.nodes.getNode(theChip.ids[i]);
						if (aBit != null && (theChip.isInputs & (1 << i)) > 0){ // check bit is used and is an input
							aBit.changed(newState);
						}
					}
				}
				theChip.lastRead = ipAll;
			}
		}
		
		this.on('close', function() {
			this.i2c1.closeSync();
		});
	}
	RED.nodes.registerType("mcp23017chip",mcp23017chipNode);

//INPUT SECTION
	function mcp23017inputNode(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		this.addr = config.addr;
		this.bitNum = config.bitNum;
		this.pullUp = config.pullUp;
		this.invert = config.invert;
		this.debounce = config.debounce;
		this.onMsg = config.onMsg;
		this.offMsg = config.offMsg;
		
		this.timerRunning = false;
		this.timer = 0;
		this.lastState = false;

		this.myChip = RED.nodes.getNode(config.chip);
		this.myChip.setBit(this.bitNum, true, this.pullUp, this.invert, this.id);
		
		this.changed = function(state) {
			if (this.timerRunning){
				clearTimeout(this.timer);
			}
			this.timer = setTimeout(this.deBounceEnd, this.debounce, state, this);
			this.timerRunning = true;
		}
		
		this.deBounceEnd = function(state, theBit){
			theBit.timerRunning = false;	
			if (theBit.lastState != state){
				var msg = {};
				msg.payload = state;
				if ((state && theBit.onMsg) ||  (! state && theBit.offMsg)){
					node.send(msg);
				}
				theBit.lastState = state
				if (state){
					theBit.status({fill:"red",shape:"ring",text:"off"});
				}else{
					theBit.status({fill:"green",shape:"dot",text:"on"});
				}
			}
		}
	}
	RED.nodes.registerType("mcp23017input",mcp23017inputNode);

//OUTPUT SECTION
	function mcp23017outputNode(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		this.addr = config.addr;
		this.bitNum = config.bitNum;
		this.invert = config.invert;
		
		this.myChip = RED.nodes.getNode(config.chip);
		this.myChip.setBit(this.bitNum, false, this.pullUp, this.invert, this.id);
		
		this.on('input', function(msg) {
			this.myChip.setOutput(this.bitNum, msg.payload)
			if (msg.payload){
				this.status({fill:"red",shape:"ring",text:"off"});
			}else{
				this.status({fill:"green",shape:"dot",text:"on"});
			}
		});
		
		
	}
	RED.nodes.registerType("mcp23017output",mcp23017outputNode);
}

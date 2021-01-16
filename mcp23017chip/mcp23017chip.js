'Strict mode'
// Read more: 

// CHIP SECTION - For inputs this reads the chip and fires the input module 
//	https://ww1.microchip.com/downloads/en/devicedoc/20001952c.pdf

// NodeRED forum about enhancing this component: 
//	https://discourse.nodered.org/t/node-red-contrib-mcp23017chip/37999

// For lisencing >> see Lisence file in the upper directory.

	// * 1 = Pin is configured as an input.
	// * 0 = Pin is configured as an output.
	// * See "3.5.1 I/O Direction register".


	//		*** chip initialisation (IOCON values) *** //
	//			... enables "byte mode" (IOCON.BANK = 0 and IOCON.SEQOP = 0).

	//bit7 BANK		= 	0 : sequential register addresses
	//bit6 MIRROR	= 	0 : use configure Interrupt 
	//bit5 SEQOP	= 	0 : sequential operation disabled, address pointer does not increment
	//bit4 DISSLW	= 	0 : The "Slew Rate" bit controls the slew rate function on the SDA pin. If enabled, the SDA slew rate will be controlled when driving from a high to low.
	//bit3 HAEN		= 	0 : hardware address pin is always enabled on 23017
	//bit2 ODR		= 	0 : open drain output.  Enables/disables the INT pin for open-drain configuration. Setting this bit overrides the INTPOL bit.
	//bit1 INTPOL	= 	0 : interrupt active low (Sets the polarity of the INT pin. This bit is functional only when the ODR bit is cleared, configuring the INT pin as active push-pull)
	//bit0 xxx unused
	//       for example SEQOP = 1:   write ( addr, IOCON, 0b00100000 ); = 32 dec = 0x20

module.exports = function(RED) {

	const busStateTexts = [
		"Opening i2c Bus",			// 0
		"Reading current state",	// 1
		"Writing byte",				// 2
		"Closing i2c bus"];			// 3

	const c_retryInt5000 = 4999;

	// IOCON.BANK = 0 mode
	const IODIR_A		= 0x00; 		//< Controls the direction of the data Input/Output for port A.
	const IODIR_B		= 0x01;			//< Controls the direction of the data Input/Output for port B.
	const IPOL_A		= 0x02;			//< Configures the polarity on the corresponding GPIO_ port bits for input port A.
	const IPOL_B		= 0x03;			//< Configures the polarity on the corresponding GPIO_ port bits for input port B.
	const GPINTEN_A		= 0x04;			//< Controls the input interrupt-on-change for each pin of port A.
	const GPINTEN_B		= 0x05;			//< Controls the input interrupt-on-change for each pin of port B.
	const DEFVAL_A		= 0x06;			//< Controls the default comparison value for interrupt-on-change for port A.
	const DEFVAL_B		= 0x07;			//< Controls the default comparison value for interrupt-on-change for port B.
	const INTCON_A		= 0x08;			//< Controls how the associated pin value is compared for the interrupt-on-change for port A.
	const INTCON_B		= 0x09;			//< Controls how the associated pin value is compared for the interrupt-on-change for port B.
	const IOCON			= 0x0A;			//< Controls the device. (0, INTPOL, ODR, HAEN, DISSLW, SEQOP, MIRROR, BANK) = 0x0B too
	const GPPU_A		= 0x0C;			//< Controls the input pull-up resistors for the port A pins.
	const GPPU_B		= 0x0D;			//< Controls the input pull-up resistors for the port B pins.
	const INTF_A		= 0x0E;			//< Reflects the input interrupt condition on the port A pins.
	const INTF_B		= 0x0F;			//< Reflects the input interrupt condition on the port B pins.
	const INTCAP_A		= 0x10;			//< Captures the port A value at the time the interrupt occurred.
	const INTCAP_B		= 0x11;			//< Captures the port B value at the time the interrupt occurred.
	const GPIO_A		= 0x12;			//< Reflects the value on the port A.
	const GPIO_B		= 0x13;			//< Reflects the value on the port B.
	const OLAT_A		= 0x14;			//< Provides access to the port A output latches.
	const OLAT_B		= 0x15;			//< Provides access to the port B output latches.

	var i2cModule = require("i2c-bus"); //https://github.com/fivdi/i2c-bus

	function mcp23017chipNode(n) {
		RED.nodes.createNode(this, n);

		this.busNum         = parseInt(n.busNum, 10); // converts string to decimal (10)
		this.addr           = parseInt(n.addr  , 16); // converts from HEXA (16) to decimal (10)
		if (isNaN(this.addr)) { this.addr = 39; }

		this.isInputs       = 0x0000;	// which ports are input ports (saved in binary form)
		this.pullUps        = 0x0000;  
		this.inverts        = 0x0000;
		this.startAllHIGH   = n.startAllHIGH; // Some relay boards are negated. (HIGH = OFF)
		this.ids            = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]; //Array(16)
		this.globalState    = 0;  // 0=uninitialized  1=working: on/off=see:ids    2=error
		this.lastRead       = 0x0000;

		// Timer related variables:
		this.interval       = 0 + n.interval;
		this.origInterv     = this.interval;
		this.chipTimer      = null;
		this.timerIsRunning = false;
		this.rwIsHappening	= false;		// global atomic bool (TODO for later)

		//console.log("chip inic ok.");
		
		this.showState = function(_obj, _onOffState, _localErr) {
			// if address is taken or a global error occurred while trying read/write to the chip	
			//console.log("...state update _obj:" + _obj + " _onOffState:" + _onOffState + " _localErr:" + _localErr + "this.globalState=" + this.globalState + " this=" + this);

			if (_localErr || (this.globalState == 2)) {
							_obj.status({fill:"red"   ,shape:"dot" ,text:"! Error"});
			}
			else
			{
				if (this.globalState == 0) {
							_obj.status({fill:"yellow",shape:"ring",text:"unknown yet"});
				}
				else
				{
					if (this.globalState == 1) { 
						if (_onOffState == true) {
							_obj.status({fill:"green" ,shape:"dot" ,text:"On"});
						}else
						if (_onOffState == false){
							_obj.status({fill:"grey"  ,shape:"ring",text:"Off"});
						}
					}
				}
			}
		}

		// TODO: block RW operations happening at the same time...
		/*
		// Sleep 10ms to wait for rwIsHappening gets false again
		const sleep10 = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
		const waitForPrevOperationToFinish = async () => {
			let maxTimeout = 0;
			while ((maxTimeout < 100) && this.rwIsHappening) {
				await sleep10(10);
				maxTimeout += 10;
			}
			return;
		} */

		this.setBit = function(_bitNum, _isInput, _pullUp, _invert, _callerNode){
			//console.log("setBit started... bitNum=" + bitNum + " isInput=" + isInput + " pullUp=" + pullUp + " invert=" + invert + " caller:" + callerNode );
			if (this.ids[_bitNum] != null ) {
				//console.log("this.ids[bitNum] != null ");
				let _id = _callerNode.id;
				if (this.ids[_bitNum] != _id ) { 
					console.log("this.ids[bitNum] != _id =" + _id );
					this.showState(_callerNode, false, true); // show error at state of the Node
					this.error("This pin is already used by an other node:" + _bitNum + "bus=" + this.busNum + " addr=" + this.addr); 
					return false;
				} // 
				
				for (var i=0; i < 16; i++){ //NEED TO REMOVE ANY OTHER REFERENCES TO THIS ID
					if (this.ids[i] == _id)  { this.ids[i] = null; }
				}
				this.ids[_bitNum] = _id; // remember, which pin (bitNum) is this Node assigned to. 
			}

			/* TODO: block RW operations happening at the same time...
			if (this.rwIsHappening) { // currently an other I2C Read/Write operation is running
				waitForPrevOperationToFinish();
				return false 
			}; */
			this.rwIsHappening = true;

			let _processState = 0;
			try {
				//console.log("opening bus...");
				this.aBus = i2cModule.openSync(this.busNum);
				this.aBus.writeByteSync(this.addr, 0x0A, 0x00); //set mode IOCON bank to 8bit mode  See: table 3.2 at chip PDF

				_processState = 2;
				if (_isInput)		{this.isInputs = this.isInputs |  (1 << _bitNum) } 
				else				{this.isInputs = this.isInputs & ~(1 << _bitNum) };

				if (_bitNum < 8)		{this.aBus.writeByteSync(this.addr, IODIR_A,  this.isInputs       & 0xFF);} //update in out mode A
				else				{this.aBus.writeByteSync(this.addr, IODIR_B, (this.isInputs >> 8) & 0xFF);} //update in out mode B
				
				if (_isInput) {
					if (_pullUp)  { this.pullUps  = this.pullUps  | (1 << _bitNum) } else { this.pullUps  = this.pullUps  & ~(1 << _bitNum) };
					if (_invert)  { this.inverts  = this.inverts  | (1 << _bitNum) } else { this.inverts  = this.inverts  & ~(1 << _bitNum) };
					this.aBus.writeByteSync(this.addr, GPPU_A ,  this.pullUps        & 0xFF); //update input pull-up 100kQ resistor A
					this.aBus.writeByteSync(this.addr, GPPU_B , (this.pullUps  >> 8) & 0xFF); //update input pull-up 100kQ resistor B
					this.aBus.writeByteSync(this.addr, IPOL_A,   this.inverts        & 0xFF); //update input invert A
					this.aBus.writeByteSync(this.addr, IPOL_B,  (this.inverts  >> 8) & 0xFF); //update input invert B
				}
				else if (this.startHighOut) {
					aBus.writeByteSync(chip.address, 0x14, 0xFF);	//Set output A to 1111111111111111
    				aBus.writeByteSync(chip.address, 0x15, 0xFF);	//Set output B to 1111111111111111
				}
				_processState = 3;
				this.aBus.closeSync();
				//console.log("OK. Closing bus.");
				return true;
			}
			catch (err) {
				if (_processState == 0)  {this.globalState = 2;}  // The whole chip in error mode
				this.error(busStateTexts[_processState] + " failed. Bus=" + this.busNum + " Pin=" + _bitNum);
				return false;
			};
			this.rwIsHappening = false;
		}
		


		this.setOutput = function(_bitNum, _newState){
			let _processState = 0;
			try {
				//console.log("setOutput: opening bus...");
				let _aBus = i2cModule.openSync(this.busNum);
				let _addr = this.addr; 
				// first it reads the current state of pins of 1 bank (A or B) (takes 4ms)
				_processState = 1;
				let ip1 = 0x00;
				if (_bitNum < 8) {
					ip1 = _aBus.readByteSync(_addr, 0x12);
				} else {
					ip1 = _aBus.readByteSync(_addr, 0x13);
					ip1 = (ip1 << 8);
				}

				if (_newState)	{ip1 = ip1 |   1 << _bitNum ;} 
				else			{ip1 = ip1 & ~(1 << _bitNum);}

				_processState = 2;
				if (_bitNum < 8)		{_aBus.writeByteSync(_addr, 0x14,  ip1       & 0xFF);}	//Set output A
				else				{_aBus.writeByteSync(_addr, 0x15, (ip1 >> 8) & 0xFF);}	//Set output B

				_processState = 3;
				_aBus.closeSync();
				//console.log("OK. Closing bus.");
				return true;
			}
			catch (err) {
				let _ee = busStateTexts[_processState] + " failed. Bus="+ this.busNum +" Addr=" + _addr + " Pin="+_bitNum + " NewState=" + _newState;
				console.error(_ee + " " + err);
				this.error([_ee, err]);
				if (_processState == 0)  {this.globalState = 2;}  // The whole chip in error mode, because the Bus could not be opened
				return false;
			};
		}


// ********** TIMER ********** // ... for input
// *************************** //

		this.startChipTimer = function(_newInterval) {
			if (_newInterval == undefined) {return null;}

			if (this.chipTimer != null) { // timer is already running
				if (this.interval == _newInterval) {return null;} // nothing to do
				clearInterval(this.chipTimer); // clear old, so a new can started
				this.interval = _newInterval;
				this.chipTimer = null;
			}

			if (this.interval < 15) { this.interval = 15 }
		
			let _isThereAnyInputNode = false;
			for (let ii=0; ii < 16; ii++) {
				if (theChip.ids[ii]) {
					const aBit1 = RED.nodes.getNode(theChip.ids[ii]);
					if (aBit1.isInput) { _isThereAnyInputNode = true; } 
				}
			}
			// STARTING a Timer in repeat mode
			if (_isThereAnyInputNode) {
				this.chipTimer = setInterval(myTimer, this.interval, this );
			}
		}

//		startChipTimer( this.interval ); // START, if any input nodes are available


		this.myTimer = function(_theChip) {
			if (isNaN(this.busNum))     {return null;}
			if (_theChip.timerIsRunning) {return;} // prevent overlapping
			_theChip.timerIsRunning = true;

			let   _processState = 0;
			let   _aBus = 0;
			const _addr = this.addr;
			let   _readTime	= new Date().getTime(); // millisec. To change the Timer value, if a too short period is set.
			try {
				//console.log("setOutput: opening bus...");
				_aBus = i2cModule.openSync(this.busNum);

				_processState = 1;
				let ipA = _aBus.readByteSync(_addr, 0x12);
				let ipB = _aBus.readByteSync(_addr, 0x13);
				_processState = 3;
				_aBus.closeSync();	
				if (_theChip.globalState != 1) {
					_theChip.globalState = 1; // successful read occured. No more "error state" or "uninitialised"
					if (this.interval == c_retryInt5000) { startChipTimer( _theChip.origInterv ); }
				}

				let ipAll = ipA + (ipB << 8);
				if (ipAll != _theChip.lastRead){
					var diffWord = ipAll ^ _theChip.lastRead;
					for (var i=0; i < 16; i++){
						if (diffWord & (1 << i)){
							const newState =  (((ipAll & (1 << i)) == 0) ? false : true) 
							const aBit = RED.nodes.getNode(_theChip.ids[i]);
							if (aBit != null && (_theChip.isInputs & (1 << i)) > 0){ // check bit is used and is an input
								aBit.changed(newState);
							}
						}
					}
					_theChip.lastRead = ipAll;
				}
			}
			catch (err) {
				err.discription = _processState + " failed.";
				err.busNumber   = this.busNum;
				err.address     = _addr;
				err.lastRead    = _theChip.lastRead;
				console.error(busStateTexts[_processState] +  " failed. Bus="+ this.busNum +" Addr=" + _addr + " theChip.lastRead=" + _theChip.lastRead);
				_theChip.error(err);
				if (_processState == 0)  {
					this.globalState = 2;   // The whole chip in error mode
					startChipTimer( c_retryInt5000 ); // re-try every 5 sec.
				} 
				this.timerIsRunning = false;
				return false;
			};
			_theChip.timerIsRunning = false;

			let _finishedIn = (new Date().getTime()) - _readTime;
			if (this.interval < _finishedIn) {  // the time the reading took was too long. Increased the interval to double of that (ms).
				_theChip.warning("Interval (" + this.interval + "ms) is too short. Setting new time = " + (_finishedIn * 2).toString);
				startChipTimer( _finishedIn * 2);
			} 
		}


		this.on('close', function() {
			try {
				if (this.myTimer) {clearInterval(this.myTimer); }
				
			}
			catch (err) { };
		});
	}

	RED.nodes.registerType("mcp23017chip", mcp23017chipNode);



//INPUT SECTION
	function mcp23017inputNode(config) {
		RED.nodes.createNode(this,config);
		
		var node 		  = this;
		this.addr   	  = config.addr;
		this.bitNum 	  = config.bitNum;
		this.pullUp 	  = config.pullUp;
		this.invert 	  = config.invert;
		this.debounce 	  = config.debounce;
		this.onMsg 		  = config.onMsg;
		this.offMsg 	  = config.offMsg;
		this.startAllHIGH = config.startAllHIGH;
		
		this.lastState 		= false;

		this.myChip = RED.nodes.getNode(config.chip);
		this.myChip.startHighOut = config.startHighOut;
		this.myChip.setBit   (this.bitNum, true, this.pullUp, this.invert, this.id);
		this.myChip.showState(this, false, false ); // shows uninit (yellow) or error (red) 

		this.deB_timer = null;
		this.changed = function(_state) {
			if (this.deB_timer != null){
				clearTimeout(this.deB_timer);
			}
			this.deB_timer = setTimeout(this.deBounceEnd, this.debounce, _state, this);
		}

		this.deBounceEnd = function(_state, _theBit){
			this.deB_timer = null;	
			if (_theBit.lastState != _state){
				var msg = {};
				msg.payload = _state;
				if ((_state && _theBit.onMsg) ||  (! _state && _theBit.offMsg)){
					node.send(msg);
				}
				_theBit.lastState = _state;
				this.myChip.showState(this, _state, false);
			}
		}
	}

	RED.nodes.registerType("mcp23017input", mcp23017inputNode);



//OUTPUT SECTION
	function mcp23017outputNode(config) {
		RED.nodes.createNode(this, config);
		
		this.bitNum       = config.bitNum;
		this.invert       = config.invert;
		this.startAllHIGH = config.startAllHIGH;
		this.initOK       = false;

		this.myChip = RED.nodes.getNode(config.chip);
		this.initOK = this.myChip.setBit(this.bitNum, false, false, false, this.id);
		this.myChip.showState(this, false, false ); // shows uninit (yellow) or error (red)
		//this.myChip.startChipTimer( this.myChip.interval );

		this.on('input', function(msg) {
			if (!this.initOK) {
				this.initOK = this.myChip.setBit(this.bitNum, false, false, false, this.id);
				if (!this.initOK) {return null}
			}

			//console.log("OUT: NEW input... payl=" + msg.payload);
			let _pinOn = (msg.payload == true) || (msg.payload == 1); //safe boolean conversion
			if (this.invert) { _pinOn = !_pinOn; }

			if (this.myChip.setOutput(this.bitNum, _pinOn)) {
				this.myChip.globalState = 1;
			}
			this.myChip.showState(this, msg.payload, false );
		});		
	}
	
	RED.nodes.registerType("mcp23017output", mcp23017outputNode);
}

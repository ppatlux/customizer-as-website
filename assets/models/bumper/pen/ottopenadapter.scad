// Otto's Pen Adapter
// Otto's pen adapter for different pen sizes.

// Otto's pen  adapter is an  easy‑to‑print accessory that gives  your HP
// Robots Otto  the ability to make  drawings using a pen.  Different pen
// sizes adapters  are available, from  BIC ballpoint pens to  Posca pens
// (see STL files for pen reference).


// The pen  adapter mounts  on the  bumper of the  Otto Gripper  and it's
// fully compatible with the Otto modular system.

// Author: Tiago Charters (18/03/2026)
// URL: https://www.printables.com/model/1642077-ottos-pen-adapter


module penadapter(rpen=8.3/2+.2){
    // BIC d=8.3
    $fn=64;
    render()
    intersection(){
	union(){
	    // https://www.printables.com/model/1603958-hp-robots-otto-gripper
	    translate([0,0,.35])
	    rotate([-90,0,0])import("hp_gripperbase_r1.stl"); 
	    cube([40,15,10],center=true);
	}
	hs=10;
	translate([0,-1.25,0])
	hull(){
	    translate([24,-3.5,0])
	    rotate([90,0,0])
	    cylinder(h=hs,r=3.9,center=true);
	    
	    translate([-24,-3.5,0])
	    rotate([90,0,0])
	    cylinder(h=hs,r=3.9,center=true);
	}
    }

    render()
    difference(){
	union(){
	    hull(){
		translate([0,2*rpen,0])
		cylinder(h=7.8,r=rpen+1.2,center=true);
		translate([0,0,0])
		cube([2*rpen+2*1.2,5,7.8],center=true);
	    }
	    translate([0,0,0])
	    cube([2*rpen+5+2*1.2,5,7.8],center=true);
	}

	translate([rpen+2.5+1.2,2.5,0])
	cylinder(h=10,r=2.5,center=true);
	translate([-rpen-2.5-1.2,2.5,0])
	cylinder(h=10,r=2.5,center=true);

	//pen
	translate([0,2*rpen,0])
	cylinder(h=10,r=rpen,center=true);
	translate([0,3*rpen,0])
	cube([1.5,2*rpen,10],center=true);
    }
    intersection(){
	union(){
	    translate([1.5,3*rpen+.5,0])
	    cylinder(h=7.8,r=1.25,center=true);
	    translate([-1.5,3*rpen+.5,0])
	    cylinder(h=7.8,r=1.25,center=true);
	}
	translate([0,2*rpen,0])
	cylinder(h=7.8,r=rpen+1.2,center=true);
    }
}


module penadapterscrew(rpen=8.3/2,h=6){
    // BIC d=8.3
    $fn=64;
    render()
    intersection(){
	union(){
	    // https://www.printables.com/model/1603958-hp-robots-otto-gripper
	    translate([0,0,.35])
	    rotate([-90,0,0])import("hp_gripperbase_r1.stl"); 
	    cube([40,15,10],center=true);
	}
	hs=10;
	translate([0,-1.25,0])
	hull(){
	    translate([24,-3.5,0])
	    rotate([90,0,0])
	    cylinder(h=hs,r=3.9,center=true);
	    
	    translate([-24,-3.5,0])
	    rotate([90,0,0])
	    cylinder(h=hs,r=3.9,center=true);
	}
    }

    difference(){
	union(){
	    hull(){
		translate([0,2*rpen,0])
		cylinder(h=7.8,r=rpen+h,center=true);
		translate([0,0,0])
		cube([2*rpen+2*h,5,7.8],center=true);
	    }
	    translate([0,0,0])
	    cube([2*rpen+5+2*h,5,7.8],center=true);
	}

	// rounding
	translate([rpen+2.5+h,2.5,0])
	cylinder(h=10,r=2.5,center=true);

	translate([-rpen-2.5-h,2.5,0])
	cylinder(h=10,r=2.5,center=true);

	//pen
	translate([0,2*rpen,0])
	cylinder(h=10,r=rpen,center=true);

	// nut
	translate([0,3*rpen+2.2,0])
	cube([5.6,2.8,10+.1],center=true);

	// screw
	translate([0,3*rpen+2.2,0])
	rotate([90,0,0])
	cylinder(h=h+rpen,r=1.5+.2,center=true);
    }

}

$vpr=[75,0,5*45];

//!penadapter();
penadapterscrew();
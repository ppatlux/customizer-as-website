import time
import board
import pwmio
import math

CENTER = 90  

PAN_CENTER_OFFSET = 0
PAN_CENTER = CENTER + PAN_CENTER_OFFSET
MAX_LEFT = 30
MAX_RIGHT = -30
PAN_SWING = min(abs(MAX_LEFT), abs(MAX_RIGHT))

TILT_CENTER_OFFSET = 0
TILT_CENTER = CENTER + TILT_CENTER_OFFSET
MAX_UP = -10
MAX_DOWN = 10
TILT_SWING = min(abs(MAX_UP), abs(MAX_DOWN))

# connector 8 = GPIO 27
servo_pan = pwmio.PWMOut(board.GP27, frequency=50, duty_cycle=0)
# connector 9 = GPIO 15
servo_tilt = pwmio.PWMOut(board.GP15, frequency=50, duty_cycle=0)
ANIMATION_SPEED = 600

def angle_to_duty(degrees: int) -> int:
    min_us  = 500
    max_us  = 2500
    period_us = 20_000  # 50 Hz
    pulse_us = min_us + (max_us - min_us) * degrees // 180
    return int(pulse_us / period_us * 65535)

def move_to(servo: pwmio.PWMOut, degrees: int) -> None:
    servo.duty_cycle = angle_to_duty(degrees)

def ease_in_out(t: float) -> float:
    return t * t * (3 - 2 * t)

def ease_in(t: float) -> float:
    return t * t

def ease_out(t: float) -> float:
    return 1 - (1 - t) * (1 - t)

def ease_bounce(t: float) -> float:
    c = 1.70158
    return t * t * ((c + 1) * t - c)

def ease_elastic(t: float) -> float:
    if t == 0 or t == 1:
        return t
    return -(2 ** (10 * t - 10)) * math.sin((t * 10 - 10.75) * (2 * math.pi / 3))

EASING = {
    "linear":  lambda t: t,
    "in_out":  ease_in_out,
    "in":      ease_in,
    "out":     ease_out,
    "bounce":  ease_bounce,
    "elastic": ease_elastic,
}

# --- Motion helpers ---

def sweep(servo: pwmio.PWMOut,
          from_deg: int,
          to_deg: int,
          duration_ms: int = 300,
          easing: str = "in_out",
          steps: int = 40) -> None:
    ease_fn = EASING.get(easing, ease_in_out)
    delay = duration_ms / steps / 1000

    for i in range(steps + 1):
        t = i / steps
        eased = ease_fn(t)
        deg = int(from_deg + (to_deg - from_deg) * eased)
        move_to(servo, max(0, min(180, deg)))
        time.sleep(max(0.001, delay))

def sweep2(sx: pwmio.PWMOut, 
           sy: pwmio.PWMOut,
           from_x: int, 
           to_x: int,
           from_y: int, 
           to_y: int,
           duration_ms: int = 300,
           easing_x: str = "in_out",
           easing_y: str = "in_out",
           steps: int = 40) -> None:
    ease_x = EASING.get(easing_x, ease_in_out)
    ease_y = EASING.get(easing_y, ease_in_out)
    delay = (duration_ms / steps) / 1000

    for i in range(steps + 1):
        t = i / steps
        deg_x = int(from_x + (to_x - from_x) * ease_x(t))
        deg_y = int(from_y + (to_y - from_y) * ease_y(t))
        move_to(sx, deg_x)
        move_to(sy, deg_y)
        time.sleep(max(0.001, delay))

# --- Emotion animations ---

def sweepLeftRight() -> None:
    sweep(servo_pan, PAN_CENTER,  PAN_CENTER + MAX_RIGHT,  ANIMATION_SPEED, easing="in_out")
    time.sleep(1)

    sweep(servo_pan, PAN_CENTER + MAX_RIGHT,  PAN_CENTER + MAX_LEFT,  ANIMATION_SPEED, easing="in_out")
    time.sleep(1)

    sweep(servo_pan, PAN_CENTER + MAX_LEFT,  PAN_CENTER + MAX_RIGHT,  ANIMATION_SPEED, easing="in_out")
    time.sleep(1)

    sweep(servo_pan, PAN_CENTER + MAX_RIGHT,  PAN_CENTER,  ANIMATION_SPEED, easing="in_out")
    time.sleep(1)    

def sweepUpDown() -> None:
    sweep(servo_tilt, TILT_CENTER,  TILT_CENTER + MAX_UP,  ANIMATION_SPEED, easing="linear")
    time.sleep(1)

    sweep(servo_tilt, TILT_CENTER + MAX_UP,  TILT_CENTER + MAX_DOWN,  ANIMATION_SPEED, easing="linear")
    time.sleep(1)

    sweep(servo_tilt, TILT_CENTER + MAX_DOWN,  TILT_CENTER + MAX_UP,  ANIMATION_SPEED, easing="linear")
    time.sleep(1)

    sweep(servo_tilt, TILT_CENTER + MAX_UP,  TILT_CENTER,  ANIMATION_SPEED, easing="linear")
    time.sleep(1)

def figure_eight(servo_pan: pwmio.PWMOut = servo_pan,
            servo_tilt: pwmio.PWMOut = servo_tilt,
            center_pan: int = PAN_CENTER, 
            center_tilt: int = TILT_CENTER,
            pan_swing: int = PAN_SWING, 
            tilt_swing: int = TILT_SWING, 
            cycles: int = 2,
            duration_ms: int = 2000) -> None:
    steps = 60
    delay = (duration_ms / steps) / 1000  # seconds, as a float

    for cycle in range(cycles):
        for i in range(steps + 1):
            t = i / steps
            # Pan follows a full sine wave, tilt follows double frequency
            # that's what traces a figure-8
            deg_pan  = int(center_pan  + pan_swing * math.sin(2 * math.pi * t))
            deg_tilt = int(center_tilt + tilt_swing * math.sin(4 * math.pi * t) * 0.5)
            move_to(servo_pan,  max(0, min(180, deg_pan)))
            move_to(servo_tilt, max(0, min(180, deg_tilt)))
            time.sleep(max(0.001, delay))

    sweep2(servo_pan, servo_tilt,
           deg_pan, center_pan,
           deg_tilt, center_tilt,
           duration_ms=200)
    
def shake_no(servo_pan: pwmio.PWMOut = servo_pan,
             center=PAN_CENTER,
             swing=PAN_SWING,
             shakes=2,
             sweep_ms=100,
             hold_ms=200,
             easing="bounce"):
    left  = center - swing
    right = center + swing

    sweep(servo_pan, center, left, sweep_ms, easing="in_out")
    for _ in range(shakes):
        sweep(servo_pan, left,  right, sweep_ms * 2, easing=easing)
        sweep(servo_pan, right, left,  sweep_ms * 2, easing=easing)
    sweep(servo_pan, left, center, sweep_ms, easing="in_out")
    time.sleep(hold_ms / 1000)

def nod_yes(servo_tilt: pwmio.PWMOut = servo_tilt,
            center=TILT_CENTER,
            swing=TILT_SWING,
            shakes=2,
            sweep_ms=100,
            hold_ms=100,
            easing="in_out"):
    down = center + swing // 1.5
    up   = center - swing // 1.5

    sweep(servo_tilt, center, down, sweep_ms, easing="out")
    for _ in range(shakes):
        sweep(servo_tilt, down, up, sweep_ms * 2, easing=easing)
        sweep(servo_tilt, up, down, sweep_ms * 2, easing=easing)
    sweep(servo_tilt, down, center, sweep_ms, easing="in")
    time.sleep(hold_ms / 1000)

def sadNo():
    sweep(servo_tilt, TILT_CENTER, TILT_CENTER + MAX_DOWN, 400, easing="out")    
    shake_no(shakes=2, swing=PAN_SWING / 4, sweep_ms=200, easing="linear")
    sweep(servo_tilt, TILT_CENTER + MAX_DOWN, TILT_CENTER, 400, easing="out")    

def tired():
    sweep(servo_tilt, TILT_CENTER, TILT_CENTER + MAX_DOWN, 2000, easing="out")   
    sweep(servo_tilt, TILT_CENTER + MAX_DOWN, TILT_CENTER, 10, easing="out")  
    time.sleep(0.2)
    shake_no(shakes=2, swing=PAN_SWING / 4, sweep_ms=10, easing="linear")  

def circle(servo_pan: pwmio.PWMOut = servo_pan,
        servo_tilt: pwmio.PWMOut = servo_tilt,
        pan_center: int = PAN_CENTER, 
        tilt_center: int = TILT_CENTER,
        pan_swing: int = PAN_SWING, 
        tilt_swing: int = TILT_SWING, 
        duration_ms=2000):
    steps = 60
    delay = (duration_ms / steps) / 1000

    for i in range(steps + 1):
        t = i / steps
        deg_pan  = int(pan_center  + pan_swing * math.sin(2 * math.pi * t))
        deg_tilt = int(tilt_center + tilt_swing * math.cos(2 * math.pi * t))
        move_to(servo_pan,  deg_pan)
        move_to(servo_tilt, deg_tilt)
        time.sleep(max(0.001, delay))

    sweep2(servo_pan, servo_tilt,
           deg_pan,  pan_center,
           deg_tilt, tilt_center,
           duration_ms=300)
    
def thinking(servo_pan: pwmio.PWMOut = servo_pan,
             servo_tilt: pwmio.PWMOut = servo_tilt,
             pan_center: int = PAN_CENTER,
             tilt_center: int = TILT_CENTER,
             pan_swing: int = PAN_SWING,
             tilt_swing: int = TILT_SWING,
             hold_ms: int = 2500,
             duration_ms: int = 600):

    tilted_pan  = pan_center  + pan_swing
    tilted_tilt = tilt_center - tilt_swing

    sweep2(servo_pan, servo_tilt,
           pan_center,  tilted_pan,
           tilt_center, tilted_tilt,
           duration_ms=duration_ms)

    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           tilted_pan,  pan_center,
           tilted_tilt, tilt_center,
           duration_ms=duration_ms)
    
def surprised(servo_pan: pwmio.PWMOut = servo_pan,
              servo_tilt: pwmio.PWMOut = servo_tilt,
              pan_center: int = PAN_CENTER,
              tilt_center: int = TILT_CENTER,
              pan_swing: int = PAN_SWING,
              tilt_swing: int = TILT_SWING,
              hold_ms: int = 800,
              duration_ms: int = 10):

    tilted_tilt = tilt_center - tilt_swing

    sweep2(servo_pan, servo_tilt,
           pan_center, pan_center,
           tilt_center, tilted_tilt,
           duration_ms=duration_ms // 4,
           easing_y="elastic")

    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           pan_center, pan_center,
           tilted_tilt, tilt_center,
           duration_ms=duration_ms,
           easing_y="in_out")
    
def scared(servo_pan: pwmio.PWMOut = servo_pan,
           servo_tilt: pwmio.PWMOut = servo_tilt,
           pan_center: int = PAN_CENTER,
           tilt_center: int = TILT_CENTER,
           pan_swing: int = PAN_SWING,
           tilt_swing: int = TILT_SWING,
           shakes: int = 4,
           hold_ms: int = 100,
           duration_ms: int = 200):

    scared_tilt = tilt_center - (tilt_swing // 2)
    small_pan   = pan_swing // 3

    sweep2(servo_pan, servo_tilt,
           pan_center, pan_center,
           tilt_center, scared_tilt,
           duration_ms=duration_ms // 4,
           easing_y="out")

    for _ in range(shakes):
        sweep2(servo_pan, servo_tilt,
               pan_center,          pan_center - small_pan,
               scared_tilt,         scared_tilt,
               duration_ms=duration_ms // 6,
               easing_x="in_out")
        sweep2(servo_pan, servo_tilt,
               pan_center - small_pan, pan_center + small_pan,
               scared_tilt,            scared_tilt,
               duration_ms=duration_ms // 5,
               easing_x="in_out")
        sweep2(servo_pan, servo_tilt,
               pan_center + small_pan, pan_center,
               scared_tilt,            scared_tilt,
               duration_ms=duration_ms // 6,
               easing_x="in_out")

    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           pan_center, pan_center,
           scared_tilt, tilt_center,
           duration_ms=duration_ms,
           easing_y="in_out")
    
def double_take(servo_pan: pwmio.PWMOut = servo_pan,
                servo_tilt: pwmio.PWMOut = servo_tilt,
                pan_center: int = PAN_CENTER,
                tilt_center: int = TILT_CENTER,
                pan_swing: int = PAN_SWING,
                tilt_swing: int = TILT_SWING,
                hold_ms: int = 1000,
                duration_ms: int = 600):

    half_pan = pan_center + (pan_swing // 2)
    full_pan = pan_center + pan_swing

    sweep2(servo_pan, servo_tilt,
           pan_center,  half_pan,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")

    sweep2(servo_pan, servo_tilt,
           half_pan,  pan_center,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="in_out")

    time.sleep((hold_ms // 2) / 1000)

    sweep2(servo_pan, servo_tilt,
           pan_center,  full_pan,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 12,
           easing_x="elastic")

    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           full_pan,  pan_center,
           tilt_center, tilt_center,
           duration_ms=duration_ms,
           easing_x="in_out")
    
def excited(servo_pan: pwmio.PWMOut = servo_pan,
            servo_tilt: pwmio.PWMOut = servo_tilt,
            pan_center: int = PAN_CENTER,
            tilt_center: int = TILT_CENTER,
            pan_swing: int = PAN_SWING,
            tilt_swing: int = TILT_SWING,
            shakes: int = 6,
            duration_ms: int = 300):

    small_pan  = pan_swing  // 3
    small_tilt = tilt_swing // 3

    for i in range(shakes):
        # Alternate direction each shake
        pan_dir  =  1 if i % 2 == 0 else -1
        tilt_dir =  1 if i % 3 == 0 else -1

        sweep2(servo_pan, servo_tilt,
               pan_center,
               pan_center  + small_pan  * pan_dir,
               tilt_center,
               tilt_center + small_tilt * tilt_dir,
               duration_ms=duration_ms // 8,
               easing_x="in_out",
               easing_y="in_out")

        sweep2(servo_pan, servo_tilt,
               pan_center  + small_pan  * pan_dir,  pan_center,
               tilt_center + small_tilt * tilt_dir, tilt_center,
               duration_ms=duration_ms // 8,
               easing_x="in_out",
               easing_y="in_out")

    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 4,
           easing_x="bounce",
           easing_y="bounce")
    
def shy(servo_pan: pwmio.PWMOut = servo_pan,
        servo_tilt: pwmio.PWMOut = servo_tilt,
        pan_center: int = PAN_CENTER,
        tilt_center: int = TILT_CENTER,
        pan_swing: int = PAN_SWING,
        tilt_swing: int = TILT_SWING,
        hold_ms: int = 2000,
        duration_ms: int = 800):

    shy_pan  = pan_center  + (pan_swing  // 2)
    shy_tilt = tilt_center + (tilt_swing // 1)

    sweep2(servo_pan, servo_tilt,
           pan_center, shy_pan,
           tilt_center, shy_tilt,
           duration_ms=duration_ms,
           easing_x="in_out",
           easing_y="in_out")

    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           shy_pan,  pan_center,
           shy_tilt, shy_tilt,
           duration_ms=duration_ms,
           easing_x="out")

    sweep2(servo_pan, servo_tilt,
           pan_center, pan_center,
           shy_tilt,   tilt_center,
           duration_ms=duration_ms,
           easing_y="out")
    
def follow_me(servo_pan: pwmio.PWMOut = servo_pan,
              servo_tilt: pwmio.PWMOut = servo_tilt,
              pan_center: int = PAN_CENTER,
              tilt_center: int = TILT_CENTER,
              pan_swing: int = PAN_SWING,
              tilt_swing: int = TILT_SWING,
              beckons: int = 3,
              hold_ms: int = 300,
              duration_ms: int = 200):

    small_nod = tilt_center - tilt_swing // 2
    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           tilt_center, small_nod,
           duration_ms=duration_ms // 2,
           easing_x="out")
    
    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           small_nod, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")
    
    time.sleep(hold_ms / 1000)

    halfway_point = pan_center + pan_swing // 3
    full_pan = pan_center + pan_swing

    sweep2(servo_pan, servo_tilt,
           pan_center,  halfway_point,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")

    for _ in range(beckons):
        sweep2(servo_pan, servo_tilt,
           halfway_point,  full_pan,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")
        
        sweep2(servo_pan, servo_tilt,
           full_pan,  halfway_point,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")
        
        time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
           halfway_point,  pan_center,
           tilt_center, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="in_out")
    
def ashamed(servo_pan: pwmio.PWMOut = servo_pan,
              servo_tilt: pwmio.PWMOut = servo_tilt,
              pan_center: int = PAN_CENTER,
              tilt_center: int = TILT_CENTER,
              tilt_swing: int = MAX_DOWN,
              hold_ms: int = 2000,
              duration_ms: int = 200):

    full_nod = tilt_center + tilt_swing
    small_nod = tilt_center + tilt_swing // 2

    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           tilt_center, full_nod,
           duration_ms=duration_ms,
           easing_x="out")
    
    time.sleep(hold_ms / 1000)
    
    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           full_nod, small_nod,
           duration_ms=duration_ms // 2,
           easing_x="out")
    
    time.sleep(hold_ms / 1000)

    sweep2(servo_pan, servo_tilt,
        pan_center,  pan_center,
        small_nod, tilt_center,
        duration_ms=duration_ms // 2,
        easing_x="out")
    
def hello(servo_pan: pwmio.PWMOut = servo_pan,
              servo_tilt: pwmio.PWMOut = servo_tilt,
              pan_center: int = PAN_CENTER,
              tilt_center: int = TILT_CENTER,
              tilt_swing: int = MAX_DOWN,
              hold_ms: int = 100,
              duration_ms: int = 100):
    
    full_nod = tilt_center - tilt_swing // 2

    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           tilt_center, full_nod,
           duration_ms=duration_ms,
           easing_x="out")
    
    time.sleep(hold_ms / 1000)
    
    sweep2(servo_pan, servo_tilt,
           pan_center,  pan_center,
           full_nod, tilt_center,
           duration_ms=duration_ms // 2,
           easing_x="out")

    
try:
    sleep_between_animations = 3
    move_to(servo_pan, PAN_CENTER)
    move_to(servo_tilt, TILT_CENTER)
    time.sleep(10)

    hello()
    time.sleep(sleep_between_animations)

    nod_yes() 
    time.sleep(sleep_between_animations)

    shake_no()
    time.sleep(sleep_between_animations)

    scared()
    time.sleep(sleep_between_animations)

    sadNo()
    time.sleep(sleep_between_animations)

    tired()
    time.sleep(sleep_between_animations)

    follow_me()
    time.sleep(sleep_between_animations)

    excited(shakes=12)
    time.sleep(sleep_between_animations)

    double_take()
    time.sleep(sleep_between_animations)

    ashamed()
    time.sleep(sleep_between_animations)

    circle()
    time.sleep(sleep_between_animations)

    figure_eight()
    time.sleep(sleep_between_animations)

    move_to(servo_pan, PAN_CENTER)
    move_to(servo_tilt, TILT_CENTER)
    time.sleep(1000) # time to settle
finally:
    servo_pan.deinit()
    servo_tilt.deinit()


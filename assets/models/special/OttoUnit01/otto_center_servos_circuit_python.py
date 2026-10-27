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

try:
    move_to(servo_pan, PAN_CENTER)
    move_to(servo_tilt, TILT_CENTER)
    time.sleep(10)
finally:
    servo_pan.deinit()
    servo_tilt.deinit()
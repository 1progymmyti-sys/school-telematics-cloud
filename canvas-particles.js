
export default class ParticleEngine {
    constructor() {
        this.canvas = document.getElementById('themeCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.animationId = null;
        this.theme = 'default';
        this.time = 0;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    start(themeName) {
        if (this.theme === themeName && this.animationId) return; // Already running
        this.theme = themeName;
        this.particles = [];
        this.cancel();

        console.log(`Starting particles (or flag) for theme: ${themeName}`);

        // Populate initial particles
        if (this.theme !== 'national') {
            this.initParticles();
        }
        this.animate();
    }

    cancel() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    initParticles() {
        const count = this.getParticleCount();
        for (let i = 0; i < count; i++) {
            this.particles.push(this.createParticle());
        }
    }

    getParticleCount() {
        const width = this.canvas.width;
        if (this.theme === 'christmas') return width / 5; // Snow
        if (this.theme === 'celebration') return width / 10; // Confetti
        if (this.theme === 'valentine') return width / 15; // Hearts
        if (this.theme === 'easter') return width / 10; // Glows
        if (this.theme === 'exams') return width / 12; // Math formulas
        if (this.theme === 'carnival') return width / 8; // Dense carnival
        return 0;
    }

    createParticle(reset = false) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        let p = {
            x: Math.random() * w,
            y: reset ? (this.theme === 'valentine' ? h + 20 : -20) : Math.random() * h,
            vx: 0,
            vy: 0,
            size: 0,
            color: '#fff',
            alpha: 1,
            rotation: 0,
            rotationSpeed: 0
        };

        if (this.theme === 'christmas') {
            p.vx = (Math.random() - 0.5) * 1; // Slight sway
            p.vy = Math.random() * 2 + 1; // Fall speed
            p.size = Math.random() * 3 + 1;
            p.alpha = Math.random() * 0.5 + 0.3;
        }
        else if (this.theme === 'celebration') {
            p.color = ['#f00', '#0f0', '#00f', '#ff0', '#f0f', '#0ff'][Math.floor(Math.random() * 6)];
            p.vx = (Math.random() - 0.5) * 4;
            p.vy = Math.random() * 4 + 2;
            p.size = Math.random() * 8 + 4;
            p.rotation = Math.random() * 360;
            p.rotationSpeed = (Math.random() - 0.5) * 10;
        }
        else if (this.theme === 'valentine') {
            p.color = `rgba(255, ${Math.random() * 100}, ${Math.random() * 100 + 100}, 0.6)`;
            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = -(Math.random() * 1 + 0.5); // Rise up
            p.size = Math.random() * 15 + 10;
        }
        else if (this.theme === 'easter') {
            // Soft glowing orbs
            const colors = ['#fca5a5', '#fdba74', '#fde047', '#bef264', '#86efac', '#93c5fd', '#c4b5fd', '#f9a8d4'];
            p.color = colors[Math.floor(Math.random() * colors.length)];
            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = (Math.random() - 0.5) * 0.5; // Float randomly
            p.size = Math.random() * 40 + 20; // Soft blur size
            p.size = Math.random() * 40 + 20; // Soft blur size
            p.alpha = Math.random() * 0.3 + 0.1;
        }
        else if (this.theme === 'exams') {
            const formulas = ['∑', '∫', 'π', '√', 'x²', 'E=mc²', 'sin(x)', 'limit', '∞', '%', '÷', '+', '-'];
            p.text = formulas[Math.floor(Math.random() * formulas.length)];
            // Changed color to light blue-ish white (#bfdbfe) with transparency
            p.color = `rgba(191, 219, 254, ${Math.random() * 0.4 + 0.2})`;
            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = -(Math.random() * 1 + 0.5); // Rise up
            p.size = Math.random() * 20 + 20; // 20-40px font size
            p.size = Math.random() * 20 + 20; // 20-40px font size
            p.font = 'monospace';
        }
        else if (this.theme === 'carnival') {
            const types = ['mask', 'ribbon', 'confetti', 'confetti', 'confetti'];
            p.type = types[Math.floor(Math.random() * types.length)];

            p.color = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'][Math.floor(Math.random() * 6)];

            // Slower speed
            p.vx = (Math.random() - 0.5) * 1.5;
            p.vy = Math.random() * 1.5 + 1;
            p.rotation = Math.random() * 360;
            p.rotationSpeed = (Math.random() - 0.5) * 2;

            // Semi-transparent
            p.alpha = 0.7;

            if (p.type === 'mask') {
                const masks = ['🎭', '👺', '🎪', '🎺'];
                p.text = masks[Math.floor(Math.random() * masks.length)];
                p.size = Math.random() * 40 + 30; // Large masks
            } else if (p.type === 'ribbon') {
                p.size = Math.random() * 20 + 50; // Length
                p.width = Math.random() * 5 + 2; // Width
                p.oscillation = Math.random() * 0.1;
                p.phase = Math.random() * Math.PI * 2;
            } else {
                // Confetti
                p.size = Math.random() * 10 + 5;
            }
        }

        return p;
    }

    animate() {
        if (!this.animationId && this.theme === 'default') return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.time += 0.05;

        // Render based on theme
        if (this.theme === 'national') {
            this.renderFlag();
        } else {
            this.renderParticles();
        }

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    renderFlag() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const stripeH = h / 9;
        const cantonW = stripeH * 5; // Canton is 5 stripes high

        // Wave parameters
        const waveAmp = 20;
        const waveFreq = 0.005;

        // Colors
        const blue = '#004C98'; // Official Greek Blue
        const white = '#FFFFFF';

        this.ctx.globalAlpha = 0.4; // Semi-transparent background

        // Draw by vertical slices for wave effect
        const sliceWidth = 4; // Detail level
        for (let x = 0; x < w; x += sliceWidth) {
            const yOffset = Math.sin(x * waveFreq + this.time) * waveAmp;

            for (let i = 0; i < 9; i++) {
                let isBlue = (i % 2 === 0);

                // Canton (Cross) Logic
                // Canton logic applies if we are in the top-left area (first 5 stripes, x < cantonW)
                if (i < 5 && x < cantonW) {
                    // It's generally blue, unless it's the cross
                    isBlue = true;

                    // Horizontal bar of cross is roughly stripe index 2 (the 3rd stripe)
                    if (i === 2) isBlue = false;

                    // Vertical bar of cross
                    // The cross arm width is roughly 1 stripeH.
                    // Center of cantonW is cantonW/2.
                    const centerX = cantonW / 2;
                    const halfArm = stripeH / 2;
                    if (x > centerX - halfArm && x < centerX + halfArm) isBlue = false;
                }

                this.ctx.fillStyle = isBlue ? blue : white;

                // Draw the slice part of the stripe
                // y = (stripe index * height) + wave offset
                // height = stripeH + overlap to fix tearing
                this.ctx.fillRect(x, (i * stripeH) + yOffset - 20, sliceWidth + 1, stripeH + 2);
            }
        }
        this.ctx.globalAlpha = 1;
    }

    renderParticles() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.shadowBlur = 0;

        if (this.theme === 'christmas') {
            this.ctx.shadowBlur = 5;
            this.ctx.shadowColor = '#fff';
        }

        for (let i = 0; i < this.particles.length; i++) {
            let p = this.particles[i];

            // Move
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotationSpeed;

            // Physics / Reset
            if (this.theme === 'christmas' || this.theme === 'celebration') {
                if (p.y > h) this.particles[i] = this.createParticle(true);
                if (p.x > w || p.x < 0) p.x = (p.x + w) % w; // Wrap x
            }
            else if (this.theme === 'national') {
                if (p.x > w) this.particles[i] = this.createParticle(true); // Reset to left
            }
            else if (this.theme === 'valentine') {
                if (p.y < -50) this.particles[i] = this.createParticle(true); // Reset at bottom
                p.x += Math.sin(p.y * 0.01) * 0.5; // Sway
            }
            else if (this.theme === 'easter') {
                if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) {
                    this.particles[i] = this.createParticle(true);
                    this.particles[i].x = Math.random() * w;
                    this.particles[i].y = Math.random() * h;
                }
            }
            else if (this.theme === 'exams') {
                if (p.y < -50) {
                    this.particles[i] = this.createParticle(true); // Respawn new one
                    this.particles[i].y = h + 20; // Explicitly set to bottom
                }
                // Slight wobble
                p.x += Math.sin(this.time + i) * 0.2;
            }
            else if (this.theme === 'carnival') {
                if (p.y > h + 50) this.particles[i] = this.createParticle(true);
                if (p.x > w + 50 || p.x < -50) p.x = (p.x + w) % w;

                if (p.type === 'ribbon') {
                    p.phase += 0.1;
                    p.x += Math.sin(p.phase) * 2;
                }
            }

            // Draw
            this.ctx.globalAlpha = p.alpha;

            if (this.theme === 'christmas' || this.theme === 'national') {
                this.ctx.fillStyle = p.color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
            else if (this.theme === 'celebration') {
                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate(p.rotation * Math.PI / 180);
                this.ctx.fillStyle = p.color;
                this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); // Confetti shape
                this.ctx.restore();
            }
            else if (this.theme === 'valentine') {
                this.ctx.fillStyle = p.color;
                this.drawHeart(p.x, p.y, p.size);
            }
            else if (this.theme === 'easter') {
                const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
                grad.addColorStop(0, p.color);
                grad.addColorStop(1, 'transparent');
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
            else if (this.theme === 'exams') {
                this.ctx.font = `${p.size}px ${p.font || 'sans-serif'}`;
                this.ctx.fillStyle = p.color;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(p.text, p.x, p.y);
            }
            else if (this.theme === 'carnival') {
                if (p.type === 'mask') {
                    this.ctx.font = `${p.size}px sans-serif`;
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillText(p.text, p.x, p.y);
                } else if (p.type === 'ribbon') {
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = p.color;
                    this.ctx.lineWidth = p.width;
                    this.ctx.moveTo(p.x, p.y);
                    // Draw a squiggle
                    for (let j = 0; j < p.size; j += 5) {
                        this.ctx.lineTo(
                            p.x + Math.sin((j + this.time * 10) * p.oscillation) * 10,
                            p.y - j
                        );
                    }
                    this.ctx.stroke();
                } else {
                    // Confetti
                    this.ctx.save();
                    this.ctx.translate(p.x, p.y);
                    this.ctx.rotate(p.rotation * Math.PI / 180);
                    this.ctx.fillStyle = p.color;
                    this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                    this.ctx.restore();
                }
            }
        }
        this.ctx.globalAlpha = 1;
    }

    drawHeart(x, y, size) {
        this.ctx.beginPath();
        const topCurveHeight = size * 0.3;
        this.ctx.moveTo(x, y + topCurveHeight);
        // top left curve
        this.ctx.bezierCurveTo(
            x, y,
            x - size / 2, y,
            x - size / 2, y + topCurveHeight
        );
        // bottom left curve
        this.ctx.bezierCurveTo(
            x - size / 2, y + (size + topCurveHeight) / 2,
            x, y + (size + topCurveHeight) / 2,
            x, y + size
        );
        // bottom right curve
        this.ctx.bezierCurveTo(
            x, y + (size + topCurveHeight) / 2,
            x + size / 2, y + (size + topCurveHeight) / 2,
            x + size / 2, y + topCurveHeight
        );
        // top right curve
        this.ctx.bezierCurveTo(
            x + size / 2, y,
            x, y,
            x, y + topCurveHeight
        );
        this.ctx.fill();
        this.ctx.closePath();
    }
}



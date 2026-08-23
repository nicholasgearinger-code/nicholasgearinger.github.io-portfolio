#version 300 es
precision highp float;

layout(location = 0) in vec3 position;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec3 vWorldPosition;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

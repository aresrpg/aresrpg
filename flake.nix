{
  description = "AresRPG nix flake";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem
      (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        inputLock = (builtins.fromJSON (builtins.readFile ./package-lock.json));

        rewriteDep = package: package //
          (if package ? resolved then {
            resolved = "file://${pkgs.fetchurl {
              url = package.resolved;
              outputHashAlgo = builtins.elemAt (builtins.split "-" package.integrity) 0;
              outputHash = builtins.elemAt (builtins.split "-" package.integrity) 2;
            }}";
          } else {}) //
          (if package ? dependencies then {
            dependencies = rewriteDeps package.dependencies;
          } else {});

        rewriteDeps = dependencies: builtins.mapAttrs (name: rewriteDep) dependencies;

        outputLock = builtins.toJSON ({ lockfileVersion = 2; dependencies = rewriteDeps inputLock.dependencies; });

        # TODO: remove when flakes support submodules
        floor1 = pkgs.fetchFromGitHub {
          owner = "aresrpg";
          repo = "floor1";
          rev = "644a2e4206343ef6e989ccbb28c62a4d0a5d5fb0";
          sha256 = "WuKsDHpWmgJlqNCQ9Z5V75P5AF1w3cOIDbuMxQ/EGaw=";
        };

        aresrpg = pkgs.stdenv.mkDerivation {
          name = "aresrpg";

          nativeBuildInputs = [ pkgs.nodejs-15_x ];

          src = ./.;

          passAsFile = [ "packageLock" ];

          packageLock = outputLock;

          NO_UPDATE_NOTIFIER = true;

          installPhase = ''
            cp --no-preserve=mode -r $src $out
            cd $out

            cp $packageLockPath package-lock.json

            ln -s ${floor1} world/floor1

            npm ci --production
          '';
        };
      in
        {
          devShell = pkgs.mkShell {
            buildInputs = [
              pkgs.nodejs-15_x
              pkgs.libuuid
              pkgs.cairo
              pkgs.pango
              pkgs.libjpeg
              pkgs.giflib
              pkgs.librsvg
              pkgs.python3
              pkgs.pkg-config
            ];
          };

          dockerImage = pkgs.dockerTools.buildImage {
            name = "aresrpg";
            tag = "latest";

            config = {
              Cmd = [ "${pkgs.nodejs-15_x}/bin/node" "${aresrpg}/src/index.js" ];
              ExposedPorts = {
                "25565/tcp" = {};
              };
            };
          };
        }
      );
}

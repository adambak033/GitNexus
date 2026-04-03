import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GrpcExtractor } from '../../../src/core/group/extractors/grpc-extractor.js';
import type { RepoHandle } from '../../../src/core/group/types.js';

describe('GrpcExtractor', () => {
  let tmpDir: string;
  let extractor: GrpcExtractor;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `gitnexus-grpc-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    extractor = new GrpcExtractor();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  const makeRepo = (repoPath: string): RepoHandle => ({
    id: 'test-repo',
    path: 'test/app',
    repoPath,
    storagePath: path.join(repoPath, '.gitnexus'),
  });

  describe('proto file parsing', () => {
    it('test_extract_proto_service_single_rpc_returns_provider', async () => {
      writeFile(
        'proto/auth.proto',
        `syntax = "proto3";
package auth;
service AuthService {
  rpc Login (LoginRequest) returns (LoginResponse);
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers).toHaveLength(1);
      expect(providers[0].contractId).toBe('grpc::auth.AuthService/Login');
      expect(providers[0].confidence).toBe(0.85);
      expect(providers[0].symbolRef.filePath).toBe('proto/auth.proto');
    });

    it('test_extract_proto_service_multiple_rpcs_returns_all', async () => {
      writeFile(
        'api/user.proto',
        `syntax = "proto3";
package hr.user.v1;
service UserService {
  rpc GetUser (GetUserRequest) returns (UserResponse);
  rpc ListUsers (ListUsersRequest) returns (ListUsersResponse);
  rpc DeleteUser (DeleteUserRequest) returns (Empty);
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers).toHaveLength(3);
      const ids = providers.map((c) => c.contractId).sort();
      expect(ids).toEqual([
        'grpc::hr.user.v1.UserService/DeleteUser',
        'grpc::hr.user.v1.UserService/GetUser',
        'grpc::hr.user.v1.UserService/ListUsers',
      ]);
    });

    it('test_extract_proto_without_package_uses_service_only', async () => {
      writeFile(
        'service.proto',
        `syntax = "proto3";
service HealthCheck {
  rpc Check (HealthRequest) returns (HealthResponse);
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      expect(contracts).toHaveLength(1);
      expect(contracts[0].contractId).toBe('grpc::HealthCheck/Check');
    });

    it('test_extract_proto_with_google_api_http_nested_braces', async () => {
      writeFile(
        'api/gateway.proto',
        `syntax = "proto3";
package gateway.v1;

import "google/api/annotations.proto";

service GatewayService {
  rpc GetUser (GetUserRequest) returns (UserResponse) {
    option (google.api.http) = {
      get: "/v1/users/{user_id}"
    };
  }
  rpc CreateUser (CreateUserRequest) returns (UserResponse) {
    option (google.api.http) = {
      post: "/v1/users"
      body: "*"
    };
  }
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter(
        (c) => c.role === 'provider' && c.symbolRef.filePath === 'api/gateway.proto',
      );

      expect(providers).toHaveLength(2);
      const ids = providers.map((c) => c.contractId).sort();
      expect(ids).toEqual([
        'grpc::gateway.v1.GatewayService/CreateUser',
        'grpc::gateway.v1.GatewayService/GetUser',
      ]);
    });

    it('test_extract_proto_with_multiple_services', async () => {
      writeFile(
        'api/multi.proto',
        `syntax = "proto3";
package multi;

service ServiceA {
  rpc MethodA (Req) returns (Res);
}

service ServiceB {
  rpc MethodB1 (Req) returns (Res);
  rpc MethodB2 (Req) returns (Res);
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter(
        (c) => c.role === 'provider' && c.symbolRef.filePath === 'api/multi.proto',
      );

      expect(providers).toHaveLength(3);
      const ids = providers.map((c) => c.contractId).sort();
      expect(ids).toEqual([
        'grpc::multi.ServiceA/MethodA',
        'grpc::multi.ServiceB/MethodB1',
        'grpc::multi.ServiceB/MethodB2',
      ]);
    });

    it('test_extract_proto_with_nested_option_blocks_in_rpc', async () => {
      writeFile(
        'api/nested.proto',
        `syntax = "proto3";
package nested;

service DeepService {
  rpc DeepMethod (Req) returns (Res) {
    option (google.api.http) = {
      post: "/v1/deep"
      body: "*"
      additional_bindings {
        get: "/v1/deep/{id}"
      }
    };
  }
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter(
        (c) => c.role === 'provider' && c.symbolRef.filePath === 'api/nested.proto',
      );

      expect(providers).toHaveLength(1);
      expect(providers[0].contractId).toBe('grpc::nested.DeepService/DeepMethod');
    });

    it('test_extract_proto_malformed_unclosed_brace_skips_service', async () => {
      writeFile(
        'api/broken.proto',
        `syntax = "proto3";
package broken;

service IncompleteService {
  rpc SomeMethod (Req) returns (Res);
  // Missing closing brace — EOF before depth returns to 0
`,
      );

      // Should not throw; incomplete service is silently skipped
      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter(
        (c) => c.role === 'provider' && c.symbolRef.filePath === 'api/broken.proto',
      );

      // The old regex would find partial match; the new parser should skip it
      expect(providers).toHaveLength(0);
    });
  });

  describe('Go server detection', () => {
    it('test_extract_go_register_server_returns_provider', async () => {
      writeFile(
        'cmd/server/main.go',
        `package main

import pb "example.com/proto/auth"

func main() {
    srv := grpc.NewServer()
    pb.RegisterAuthServiceServer(srv, &authServer{})
    srv.Serve(lis)
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers.length).toBeGreaterThanOrEqual(1);
      expect(providers[0].contractId).toContain('grpc::');
      expect(providers[0].contractId).toContain('AuthService');
      expect(providers[0].confidence).toBe(0.8);
    });

    it('test_extract_go_unimplemented_server_returns_provider', async () => {
      writeFile(
        'internal/server.go',
        `package server

type authServer struct {
    pb.UnimplementedAuthServiceServer
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers.length).toBeGreaterThanOrEqual(1);
      expect(providers[0].contractId).toContain('AuthService');
    });
  });

  describe('Go client detection', () => {
    it('test_extract_go_new_client_returns_consumer', async () => {
      writeFile(
        'internal/client.go',
        `package client

import pb "example.com/proto/auth"

func NewAuthClient(conn *grpc.ClientConn) pb.AuthServiceClient {
    return pb.NewAuthServiceClient(conn)
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const consumers = contracts.filter((c) => c.role === 'consumer');

      expect(consumers.length).toBeGreaterThanOrEqual(1);
      expect(consumers[0].contractId).toContain('AuthService');
      expect(consumers[0].confidence).toBe(0.7);
    });
  });

  describe('Java detection', () => {
    it('test_extract_java_grpc_service_annotation_returns_provider', async () => {
      writeFile(
        'src/main/java/AuthGrpcService.java',
        `@GrpcService
public class AuthGrpcService extends AuthServiceGrpc.AuthServiceImplBase {
    @Override
    public void login(LoginRequest req, StreamObserver<LoginResponse> obs) {}
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers.length).toBeGreaterThanOrEqual(1);
      expect(providers[0].contractId).toContain('AuthService');
      expect(providers[0].confidence).toBe(0.8);
    });

    it('test_extract_java_blocking_stub_returns_consumer', async () => {
      writeFile(
        'src/main/java/AuthClient.java',
        `public class AuthClient {
    private final AuthServiceGrpc.AuthServiceBlockingStub stub;
    public AuthClient(ManagedChannel ch) {
        this.stub = AuthServiceGrpc.newBlockingStub(ch);
    }
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const consumers = contracts.filter((c) => c.role === 'consumer');

      expect(consumers.length).toBeGreaterThanOrEqual(1);
      expect(consumers[0].contractId).toContain('AuthService');
      expect(consumers[0].confidence).toBe(0.7);
    });
  });

  describe('Python detection', () => {
    it('test_extract_python_add_servicer_returns_provider', async () => {
      writeFile(
        'server.py',
        `import grpc
from proto import auth_pb2_grpc

def serve():
    server = grpc.server(futures.ThreadPoolExecutor())
    auth_pb2_grpc.add_AuthServiceServicer_to_server(AuthServicer(), server)
    server.start()`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers.length).toBeGreaterThanOrEqual(1);
      expect(providers[0].contractId).toContain('AuthService');
      expect(providers[0].confidence).toBe(0.8);
    });

    it('test_extract_python_stub_returns_consumer', async () => {
      writeFile(
        'client.py',
        `import grpc
from proto import auth_pb2_grpc

channel = grpc.insecure_channel('localhost:50051')
stub = auth_pb2_grpc.AuthServiceStub(channel)`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const consumers = contracts.filter((c) => c.role === 'consumer');

      expect(consumers.length).toBeGreaterThanOrEqual(1);
      expect(consumers[0].contractId).toContain('AuthService');
      expect(consumers[0].confidence).toBe(0.7);
    });
  });

  describe('TypeScript/Node detection', () => {
    it('test_extract_ts_grpc_method_decorator_returns_provider', async () => {
      writeFile(
        'src/auth.controller.ts',
        `import { GrpcMethod } from '@nestjs/microservices';

export class AuthController {
  @GrpcMethod('AuthService', 'Login')
  login(data: LoginRequest): LoginResponse {
    return {};
  }
}`,
      );

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      const providers = contracts.filter((c) => c.role === 'provider');

      expect(providers.length).toBeGreaterThanOrEqual(1);
      expect(providers[0].contractId).toContain('AuthService');
      expect(providers[0].contractId).toContain('Login');
      expect(providers[0].confidence).toBe(0.8);
    });
  });

  describe('edge cases', () => {
    it('test_extract_empty_repo_returns_empty', async () => {
      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      expect(contracts).toHaveLength(0);
    });

    it('test_extract_repo_without_grpc_returns_empty', async () => {
      writeFile('src/index.ts', 'console.log("hello")');
      writeFile('package.json', '{}');

      const contracts = await extractor.extract(null, tmpDir, makeRepo(tmpDir));
      expect(contracts).toHaveLength(0);
    });
  });
});

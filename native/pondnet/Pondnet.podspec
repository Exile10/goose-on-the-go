Pod::Spec.new do |s|
  s.name = 'Pondnet'
  s.version = '0.1.0'
  s.summary = 'Application-scoped encrypted Pond networking'
  s.homepage = 'https://github.com/jarida-io/goose-in-a-pond'
  s.license = { :type => 'Third-party notices', :file => 'THIRD_PARTY_NOTICES.txt' }
  s.author = 'Jarida'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.resources = 'THIRD_PARTY_NOTICES.txt'
  s.vendored_frameworks = 'Pondnet.xcframework'
end
